# Kiến trúc tổng quan (dễ đọc)

**Lưu ý:** **`rows[]`** trong Web Worker là nguồn đọc/ghi; sau **bulk insert**, snapshot được **IndexedDB** để không mất khi reload iframe.

---

## Sơ đồ tổng thể (3 vùng)

```mermaid
flowchart LR
  subgraph MA["Main App · UI layer"]
    direction TB
    UI["UI<br/>App.tsx · debounce · pagination bar"]
    VIRT["Virtualized table<br/>@tanstack/react-virtual"]
    HOOK["useSearch<br/>requestId · startTransition"]
    BUS["MessageBus<br/>Map id → pending Promise"]
    UI --> VIRT
    UI --> HOOK --> BUS
  end

  subgraph BUS["Async messaging bus"]
    PM["postMessage giữa hai origin"]
    PROTO["vaultProtocol.ts<br/>v · ts · sig HMAC<br/>INIT · SEARCH · BULK_INSERT · GET_DATA"]
    PM --- PROTO
  end

  subgraph DV["Data Vault · iframe sandbox"]
    direction TB
    GATE["Origin gate<br/>ALLOWED_PARENT_ORIGINS"]
    MAIN["main.ts<br/>verifyWireRequest → route"]
    PROXY["workerProxy<br/>Promise ↔ Worker"]
    WK["vault.worker.ts"]
    STO[("rows[] · RAM<br/>INIT · SEARCH · BULK")]
    GATE --> MAIN --> PROXY --> WK --> STO
  end

  BUS <-->|signed envelope| PM
  PM <-->|5174 ↔ 5173| GATE
```

---

## Sơ đồ chi tiết (mapping file & luồng RPC)

```mermaid
flowchart TB
  subgraph Parent["Origin main-app — ví dụ :5174"]
    direction TB
    A["App.tsx"]
    MB["messageBus.ts<br/>send: new UUID · signWireRequest<br/>pending callbacks Map"]
    VO["vaultOrigin.ts<br/>VITE_VAULT_ORIGIN"]
    A --> MB
    MB --> VO
  end

  subgraph Wire["shared/vaultProtocol.ts"]
    W1["Canonical payload"]
    W2["HMAC-SHA256"]
    W3["Timestamp skew · reject stale"]
    W1 --> W2 --> W3
  end

  subgraph Child["Origin data-vault — ví dụ :5173"]
    direction TB
    M["main.ts<br/>ALLOWED_PARENT_ORIGINS"]
    V["verifyWireRequest"]
    P["workerProxy.ts"]
    subgraph Worker["Dedicated Worker"]
      VW["vault.worker.ts"]
      R["rows[] Row id,name,nameLc"]
      VW --- R
    end
    M --> V --> P --> VW
  end

  MB <-->|postMessage| M
  MB -.-> Wire
  M -.-> Wire

  subgraph Ops["Thao tác worker"]
    direction LR
    O1["INIT → generateData"]
    O2["SEARCH → searchPaginated O(n)"]
    O3["BULK_INSERT → slices 16k + yield"]
  end
  VW --> Ops
```

---

## Ranh giới & bus (đọc nhanh)

| Khái niệm | Trong code |
|-----------|------------|
| **Secure boundary** | Hai **origin**; không shared heap; vault chỉ tin **parent** trong allowlist + tin **đã verify** trước khi gọi worker. |
| **Bus** | Không process riêng — **`window.postMessage`** + envelope có **ký** (`signWireRequest` / `verifyWireResponse`). |
| **RPC id** | Main-app: **`id`** mỗi `send()`; hook search thêm **`requestId`** trong payload để UI bỏ qua response cũ. |
| **Storage** | **`rows[]`** trong worker — reload iframe = mất state (trừ khi INIT/bulk lại). |

---

## Luồng SEARCH (một vòng)

```mermaid
sequenceDiagram
  participant U as User
  participant App as App.tsx
  participant MB as MessageBus
  participant VP as vaultProtocol
  participant DV as vault main.ts
  participant WP as workerProxy
  participant W as vault.worker

  U->>App: gõ / đổi trang
  App->>MB: send SEARCH + page + requestId
  MB->>VP: sign envelope
  MB->>DV: postMessage
  DV->>DV: verify + origin
  DV->>WP: worker.search
  WP->>W: postMessage SEARCH
  W->>W: scan rows · paginate
  W-->>WP: rows + totalMatches
  WP-->>DV: result
  DV->>VP: sign response
  DV->>MB: postMessage
  MB->>App: resolve Promise
  App->>App: requestId match · startTransition
```

Chi tiết quyết định kỹ thuật: [../DECISION_LOG.md](../DECISION_LOG.md).
