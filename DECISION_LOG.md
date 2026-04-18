# DECISION_LOG — Data Vault System

**Điều quan trọng:** Toàn bộ **dữ liệu người dùng được lưu trong worker dưới dạng mảng trong RAM** (`data-vault/src/worker/vault.worker.ts`). **Không dùng IndexedDB, không LocalStorage cho dataset.**

---

## 1. Technical choices — Kiến trúc và code path
### 1.1 Architectural Decision: Hard Isolation via Iframe + Message Bus
Thay vì sử dụng shared state hoặc gọi API trực tiếp, tôi chủ động thiết kế hệ thống theo hướng **hard isolation**:
- **Main App** → chỉ chịu trách nhiệm UI/UX  
- **Data Vault (iframe)** → chịu trách nhiệm data processing & storage  
Hai bên giao tiếp thông qua một **asynchronous message bus** (`postMessage`).
**Lý do chiến lược:**
- **Enforced separation of concerns (SoC)** — UI layer hoàn toàn không phụ thuộc vào data layer → dễ maintain và scale  
- **Security boundary rõ ràng** — Iframe tạo ra sandbox tự nhiên → giảm nguy cơ data leakage / XSS escalation  
- **Extensibility** — Kiến trúc này có thể evolve thành Web Worker (compute-heavy), Remote service (microservice thật), mà không thay đổi contract  




### 1.2. Hai lớp “protocol” (không nhầm lẫn)

1. **Wire giữa parent và iframe** (`shared/vaultProtocol.ts`): envelope có `v`, `id`, `type`, `payload`, `ts`, `sig` — **HMAC-SHA256**, kiểm tra **`PROTOCOL_VERSION`**, **`TIMESTAMP_MAX_SKEW_MS`**, và validate payload theo từng `type` (`INIT`, `GET_DATA`, `SEARCH`, `BULK_INSERT`).
2. **RPC phía main-app** (`main-app/src/messaging/messageBus.ts`): mỗi lần `send()` tạo **`id` UUID mới**, giữ `Map<id, { resolve, reject }>` cho đến khi nhận response đã verify — tương đương **một pending reply theo correlation id**.

**Lý do:** `postMessage` thô không đủ cho demo có ý thức bảo mật; lớp ký + schema giảm giả mạo và payload sai hình dạng. Secret: `VITE_VAULT_SHARED_SECRET` (fallback dev có trong code — **production phải đổi**).

### 1.3. Worker = storage + compute (in-memory)

- File **`vault.worker.ts`**: biến module **`rows: Row[]`** với `Row = { id, name, nameLc }`.
- **`INIT`:** `generateData(n)` — dữ liệu demo cố định pattern `"User " + i`.
- **`GET_DATA`:** trả tối đa **`RESULT_CAP = 1000`** dòng đầu (preview).
- **`SEARCH`:** **`searchPaginated`** — một vòng **`for` toàn bộ `rows`**, filter theo ID rồi keyword; **không có index phụ**, độ phức tạp **O(n)** mỗi lần search.
- **`BULK_INSERT`:** `runBulkInsertAsync` — mở rộng mảng, ghi từng slice đồng bộ rồi **`await new Promise(r => setTimeout(r, 0))`** giữa các slice (**`BULK_SLICE = 16_000`**).

**Lý do:** đơn giản, hành vi dễ lý giải và benchmark; persistence / query engine là **ngoài phạm vi** implementation hiện tại.

### 1.4. Hợp đồng domain UI (`main-app/src/shared/protocol.ts`)

- **`SearchPayload`** gồm `keyword`, `requestId`, `filters`, `page`, `pageSize` — khớp payload wire sau validate.

### 1.5. UI: virtualization + ưu tiên cảm giác phản hồi

- **`@tanstack/react-virtual`**: chỉ mount hàng trong viewport — phù hợp vì React state chỉ giữ **một trang** `rows` (tối đa **`MAX_PAGE_SIZE = 200`** ở worker, UI dùng **`PAGE_SIZE = 50`** trong `App.tsx`).
- **`startTransition`** trong `useSearch`: cập nhật `setData` / meta sau khi có response.
- **Debounce** ô search trên `App.tsx` giảm số round-trip.

### 1.6. Thuật toán search trong worker (đúng như file)

- **`nameLc`** set lúc generate/bulk — **`includes`** trên `nameLc`, keyword đã `trim().toLowerCase()` một lần ở worker.
- **Filter ID** trong `rowMatches` **trước** khi xét keyword rỗng / substring — giảm so khớp chuỗi khi lọc ID hẹp.
- **Phân trang:** cùng một pass, biến `ord` đếm match; chỉ **`push`** vào `out` khi `ord` nằm trong khoảng `[page*pageSize, …)`; **`totalMatches`** cuối cùng chính là số match (trong code sau vòng lặp `ord` đã là tổng số match — xem vòng `for` và chỗ `ord++`).

**Trade-off thẳng thắn:** đây là **linear scan toàn bộ mảng**, không phải indexed query. Với rất lớn *n*, hướng mở rộng thực tế là index trong DB / WASM / service — **chưa có trong repo**.

---

## 2. Optimization — Điều code thực sự làm

| Hiện tượng | Nguyên nhân | Cách xử lý trong repo |
|------------|-------------|------------------------|
| Trả quá nhiều dòng qua iframe / React | Gửi full result set | Worker chỉ trả **`rows` của một trang** + **`totalMatches`**; **`pageSize`** clamp **`1…200`** (`DEFAULT_PAGE_SIZE` 50). |
| `toLowerCase` lặp trên hot path | So khớp tên | Field **`nameLc`** gắn sẵn mỗi row. |
| Bulk 50k–1M block worker / không nhận SEARCH | Vòng lặp dài | Slice **`BULK_SLICE` 16k** + **`setTimeout(0)`** giữa slice để nhường macrotask (SEARCH RPC có thể xen vào giữa chừng). |
| Gõ nhanh, kết quả lệch thứ tự | Response async đến không đúng thứ tự | **`requestId`** per search; trong **`useSearch`** chỉ **`setData`** nếu `requestId === latestRequestId.current`. |
| Bulk xong cần refresh nhưng không muốn kéo dài “đang bulk” | AI hay gợi ý `await search()` trong `finally` | Trong **`App.tsx`**: trong `finally` chỉ **`setBulkWorking(false)`**; **sau khối `try/catch/finally`** mới **`void search(...)`** — refresh không chặn giải phóng cờ bulk; timeout SEARCH **60s** (`useSearch`), bulk **120s** (`messageBus.send` BULK_INSERT). |
| Scroll / layout | Chiều cao không cố định | Layout cố định viewport + scroll trong vùng bảng (theo cấu trúc `App` / CSS hiện có). |

Pipeline cần nhìn xuyên suốt: **worker CPU + độ lớn payload qua iframe + React chỉ giữ một trang + virtual list**.

---

## 3. AI usage & critical thinking

### 3.1. AI phù hợp cho

- Boilerplate React (component, hook, Tailwind).
- So khớp thay đổi protocol giữa `vaultProtocol`, `messageBus`, `main.ts`, worker.

### 3.2. Người phải tự quyết

- **Đe dọa thật:** origin allowlist, secret, không commit credential.
- **Phạm vi:** chấp nhận **O(n) scan** trong worker vs đầu tư storage/index — trade-off của bài và giới hạn thời gian.
- **Chạy thật:** hai cổng dev, bulk lớn, gõ search nhanh để thấy race và timeout.

### 3.3. Ví dụ: AI gợi ý chưa phù hợp → chỉnh theo code

**Gợi ý phổ biến:** sau bulk, **`await search()` ngay trong `finally`** để “đảm bảo đồng bộ”.

**Vấn đề với luồng hiện tại:** `search` qua iframe + verify + worker có thể chạy lâu (timeout 60s); giữ await trong `finally` có thể làm cờ **`bulkWorking`** hoặc trải nghiệm “kết thúc bulk” trễ tách khỏi thực tế.

**Cách làm trong repo:** tắt **`bulkWorking`** trong `finally`, rồi gọi **`void search(...)`** ngay sau đó (không await) — refresh chạy async; đúng thứ tự vẫn được **requestId** xử lý.

**Bài học:** AI hay đúng **invariant** (“sau bulk phải refresh”) nhưng sai **composition** với async boundary và UX loading.

---

## Phụ lục — File chính

| Vai trò | Đường dẫn |
|---------|-----------|
| UI + bulk + debounce | `main-app/src/App.tsx` |
| Search hook + requestId + transition | `main-app/src/hooks/useSearch.ts` |
| postMessage RPC + pending map | `main-app/src/messaging/messageBus.ts` |
| Wire signing / validation | `shared/vaultProtocol.ts` |
| Iframe + origin + forward worker | `data-vault/src/main.ts` |
| In-memory rows + SEARCH + BULK | `data-vault/src/worker/vault.worker.ts` |
| Worker bridge | `data-vault/src/worker/workerProxy.ts` |
| Types domain | `main-app/src/shared/protocol.ts` |

---

