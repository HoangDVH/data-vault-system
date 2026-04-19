# DECISION_LOG — Data Vault System


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

### 1.3. Worker = storage + compute (RAM + IndexedDB snapshot)

- File **`vault.worker.ts`**: **`rows: Row[]`** — nguồn sự thật trong phiên.
- **Khởi động:** `restorePromise` đọc **`idbSnapshot.ts`**; nếu có dữ liệu thì **không** seed lại khi `INIT`.
- **`INIT`:** chỉ `generateData(n)` khi **`rows.length === 0`** (không có snapshot).
- **`GET_DATA`:** trả tối đa **`RESULT_CAP = 1000`** dòng đầu (preview).
- **`SEARCH`:** **`searchPaginated`** — **O(n)** scan, không index phụ.
- **`BULK_INSERT`:** slice **`BULK_SLICE = 16_000`** + yield; **cuối cùng `saveRowsSnapshot(rows)`** để reload giữ inserted rows.

**Trade-off:** snapshot là **full array** trong một key IDB — đơn giản; dataset rất lớn có thể chậm khi ghi (chấp nhận sau bulk).

### 1.4. Hợp đồng domain UI (`main-app/src/shared/protocol.ts`)

- **`SearchPayload`** gồm `keyword`, `requestId`, `filters`, `page`, `pageSize` — khớp payload wire sau validate.

### 1.5 Search Strategy: Indexed + Preprocessing

Không dùng `.filter()` trên array lớn vì:

- O(n) → không đạt <100ms với 500k records

Thay vào đó:

- Tạo index theo field (name, email,...)
- Normalize data trước (lowercase, remove space)

### 1.6 UI Rendering: Virtualization

Với danh sách lớn:

- Không render full DOM

→ Dùng:

- windowing / virtualization

Lý do:

- Giảm DOM nodes từ 500k → ~20–50
- FPS ổn định

### 1.7 Bulk Insert Strategy

**Hướng xử lý:** Ghi theo **từng lát**, giữa các lát **nhường CPU** một nhịp; xong thì **lưu IndexedDB** rồi mới báo thành công cho UI.

#### Trong `runBulkInsertAsync` (`vault.worker.ts`)

| Bước | Ý nghĩa ngắn gọn |
|------|------------------|
| **`await ready()`** | Chờ đọc snapshot cũ xong trước khi insert — tránh chèn bulk lên trạng thái chưa khôi phục. |
| **`count` có giới hạn** | `clamp` trong khoảng **1 … 1 000 000**. UI mặc định **50 000**. Trần phòng nhập nhầm / payload quá lớn. |
| **`rows.length = start + count`** | Mở rộng mảng **một lần** (đủ chỗ cho batch mới). Tránh `.push` liên tục khiến mảng phải **tăng buffer nhiều lần**. |
| **Lát `BULK_SLICE = 16_000`** | Mỗi lát: vòng `for` gán nhanh từng `Row` (`id`, `name`, `nameLc`). ID nối tiếp: `start + i`. |
| **`await setTimeout(0)` sau mỗi lát** | **Nhường một nhịp** — bulk không nuốt worker suốt một đoạn dài; các tin trong hàng đợi có **cơ hội** được xử lý xen giữa các lát (không cam kết real-time tuyệt đối). |
| **`await saveRowsSnapshot(rows)` trước tin success** | User thấy toast “xong” thì IndexedDB đã có **đúng** `rows` sau bulk — reload ngay không bị “chưa kịp ghi”. |
| **Trả `{ inserted, totalRows }`** | UI cập nhật toast và tổng số dòng. |

#### Đánh đổi `BULK_SLICE`

- **Slice lớn** → ít nhịp nhường → bulk có thể **xong nhanh hơn**, nhưng mỗi đoạn đồng bộ **dài** → ít chỗ xen `SEARCH`.
- **Slice nhỏ** → nhường **thường xuyên** → vault **mềm** hơn khi user tìm xen kẽ, nhưng **nhiều nhịp yield** hơn.

#### UI (main-app)

- Bulk dùng timeout **120s** trên `messageBus`.
- Sau bulk: tắt cờ **`bulkWorking`**, gọi **`void search(...)`** (không `await`) để làm mới danh sách mà không kéo dài trạng thái loading.




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

