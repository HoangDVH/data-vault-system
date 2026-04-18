# DECISION_LOG — Data Vault System

**Mục đích file (quan trọng nhất):** Đây không phải README kỹ thuật thuần túy, mà là **chứng cứ suy luận** — ghi lại *vì sao* chọn hướng đi, *đánh đổi* gì, *lỗi hiệu năng* gặp trên đường đi và *vai trò AI* trong quá trình đó. Người đọc có thể suy ra: mức độ chủ động, độ sâu kiến trúc, và khả năng **kiểm soát** công cụ thay vì phụ thuộc máy móc.

Phạm vi: monorepo `data-vault-system` — **main-app** (UI React) + **data-vault** (iframe, worker, dữ liệu nặng) + **shared** (giao thức wire).

---

## 1. Technical choices — Kiến trúc và công nghệ / thuật toán

### 1.1. Tách Main app và Data Vault (iframe, origin khác nhau)

- **Main app** (thường Vite `:5174`): ô tìm kiếm, filter Min/Max ID, bảng ảo hóa, phân trang, bulk insert — tương tác người dùng.
- **Data vault** (thường `:5173`): chạy trong **iframe**, chứa **worker** và bộ nhớ chứa dòng dữ liệu lớn.

**Lý do (trade-off có ý thức):**

- **Same-Origin Policy:** hai origin tách nhau (`localhost:5173` vs `localhost:5174`) buộc ta không “chia sẻ biến JS” trực tiếp giữa UI và kho dữ liệu; ta chấp nhận chi phối **postMessage** để đổi lấy ranh giới an toàn và tách **đường dữ liệu nặng** khỏi shell UI.
- **Payload có kiểm soát:** chỉ đẩy qua ranh giới những gì cần cho một request/response (không clone toàn bộ dataset về main thread).

### 1.2. Wire protocol (`shared/vaultProtocol.ts`)

- Phiên bản **`PROTOCOL_VERSION`**, tin nhắn có **timestamp** và **`TIMESTAMP_MAX_SKEW_MS`** để giới hạn cửa sổ chấp nhận (giảm rủi ro replay đơn giản / lệch đồng hồ trong demo).
- **HMAC-SHA256** khi có shared secret (`VITE_VAULT_SHARED_SECRET`); validate payload theo từng loại (`INIT`, `SEARCH`, `BULK_INSERT`, …).

**Lý do:** iframe messaging không đi qua một API HTTP riêng có middleware chuẩn; **ký + schema** là lớp tối thiểu để tránh tin giả và input bừa bãi trong bối cảnh demo/staging. (Production vẫn cần review thêm: origin policy, rate limit, quản lý secret, threat model.)

### 1.3. Worker + Promise proxy

- Worker `data-vault/src/worker/vault.worker.ts` giữ **mảng dòng** trong memory, xử lý **`INIT`**, **`SEARCH`**, **`BULK_INSERT`**.
- `workerProxy.ts` nối main thread của iframe với worker theo kiểu Promise/async.

**Lý do:** tách **CPU và bộ nhớ nặng** khỏi luồng UI của iframe; tránh block dài trên main thread khi quét hoặc insert lớn.

### 1.4. Hợp đồng domain (`main-app/src/shared/protocol.ts`)

- Type cho **`User`**, **`SearchPayload`** (keyword, filters, `requestId`, `page`, `pageSize`), **`SearchResponse`** (rows, `totalMatches`, meta phân trang), v.v.

**Lý do:** một nguồn sự thật cho UI và messaging; giảm lệch kiểu giữa vault và main.

### 1.5. UI React — ảo hóa và cảm giác phản hồi

- **`@tanstack/react-virtual`:** chỉ render hàng trong viewport của trang hiện tại → scroll ổn định khi một “trang” dữ liệu có nhiều dòng.
- **`startTransition`** trong `useSearch`: ưu tiên cảm giác nhập liệu mượt sau khi nhận response.
- **Debounce** ô tìm kiếm; tránh `await search()` trong `finally` của bulk theo kiểu chặn toàn bộ luồng UI khi không cần.

**Lý do:** bottleneck thường là **số phần tử React** và **tần suất re-render**, không chỉ là thuật toán trong worker.

### 1.6. Thuật toán tìm kiếm trong worker (đủ cho demo)

- Chuẩn hóa **`nameLc`** khi generate để **`includes`** trên chuỗi đã lowercase — tránh gọi `toLowerCase()` lặp trên hot path cho mỗi so khớp.
- **`SEARCH` phân trang:** một pass quét, đếm **`totalMatches`**, chỉ serializing **`rows` của một trang** (giới hạn `pageSize`, ví dụ max 200).
- Min/Max ID áp **trước** keyword khi có thể → giảm chi phí so khớp chuỗi khi filter ID đã loại được nhiều dòng.

**Trade-off:** không có inverted index / full-text engine — đơn giản, dễ lý giải; không scale như DB có index. Đây là quyết định **phạm vi bài toán**, không phải quên các hướng khác.

---

## 2. Optimization — Hiệu năng đã va chạm và cách xử lý

| Vấn đề quan sát được | Nguyên nhân gốc (mức cao) | Cách xử lý trong code |
|----------------------|---------------------------|------------------------|
| Payload quá lớn qua iframe, React nặng | Trả “full result set” một lần | **Phân trang server-side trong worker**: chỉ gửi một trang + `totalMatches`. |
| `toLowerCase` trên mỗi lần so khớp | Hot path string trên dataset lớn | **Cột phụ `nameLc`** khi khởi tạo / bulk. |
| Bulk +50k đơ luồng | Vòng lặp dài chiếm worker, queue message | **`BULK_SLICE`** (16k), sau slice **`await setTimeout(0)`** để nhường event loop — xen kẽ **`SEARCH`**. |
| Gõ nhanh, kết quả nhảy lộn xộn | Request cũ hoàn thành sau request mới | **`requestId`** + chỉ áp dụng state nếu khớp **`latestRequestId`**. |
| Bulk xong UI “kẹt” / timeout search | State `bulkWorking` + await search chặn | **`finally`** clear `bulkWorking` **trước** khi fire-and-forget `search()`; timeout **`SEARCH`** đủ lớn cho tập lớn (ví dụ 60s). |
| Double scroll / layout nhảy | Chiều cao viewport không cố định | Scroll chỉ trong vùng bảng; viewport root cố định. |

**Điểm senior cần thấy:** tối ưu ở đây là **đoạn pipeline end-to-end** (worker ↔ postMessage ↔ React virtualization ↔ trạng thái async), không chỉ “viết vòng for nhanh hơn”.

---

## 3. AI usage & critical thinking — Phần nào dùng AI, phần nào không

### 3.1. AI đã hỗ trợ hiệu quả ở đâu

- **Boilerplate UI:** component, hook `useSearch`, thanh phân trang, toast, lớp Tailwind đồng bộ.
- **Điều tra nhanh luồng:** trace `postMessage`, origin, timeout, đường đi bulk → worker.
- **Đồng bộ protocol:** thêm field phân trang / validate chéo giữa `vaultProtocol`, worker, và client.

### 3.2. Việc con người vẫn phải giữ (không outsource cho AI)

- **Mô hình đe dọa thật:** secret env, production HMAC/CORS/origin — AI chỉ phản ánh policy đã ghi trong code.
- **Phạm vi kiến trúc:** khi nào đủ “một pass + phân trang” vs khi cần DB/index — AI hay đề xuất “công nghệ nặng” không khớp bài.
- **Xác nhận bằng chạy thực tế:** hai dev server, secret khớp, bulk 50k, race khi gõ — không thể thay bằng lý thuyết.

### 3.3. Ít nhất một trường hợp: AI đề xuất sai / chưa tối ưu và cách tự chỉnh

**Tình huống:** Khi hoàn thiện luồng **bulk insert** và refresh danh sách sau khi insert, gợi ý ban đầu (AI) là **luôn `await search()` trong `finally`** của bulk — vì “đảm bảo state đồng bộ và luôn có dữ liệu mới nhất”.

**Vì sao đó là chưa phù hợp với bài toán này:**

- `search()` là async qua iframe + worker + có thể timeout dài trên tập lớn; giữ **`await`** trong `finally` kéo dài window mà **`bulkWorking`** hoặc UX loading vẫn có thể gây cảm giác **UI bị khóa** hoặc tranh chấp với các thao tác khác (ví dụ user muốn gõ filter ngay).
- Trên pipeline đã có **`requestId`** để xử lý race; refresh danh sách không cần “đồng bộ cứng” trong cùng một stack frame với kết thúc bulk.

**Điều chỉnh đã áp dụng:** **clear flag `bulkWorking` (và các trạng thái liên quan) trước**, rồi **gọi `search()` kiểu fire-and-forget** (không `await` trong `finally`), với timeout `SEARCH` đủ lớn cho dataset. Như vậy bulk **kết thúc gọn** về mặt UI, còn tìm kiếm chạy nền với contract async sẵn có.

**Bài học:** Gợi ý AI thường **đúng về mặt “invariant”** (sau bulk cần refresh), nhưng **sai về composition** với luồng async + iframe + trạng thái loading. Senior kiểm tra **thời điểm giải phóng UI** và **độ dài critical section**, không chỉ “code chạy ra kết quả đúng một lần”.

### 3.4. Nguyên tắc dùng AI trong repo này

- Ghi **DECISION_LOG** / comment ngắn tại chỗ **trade-off** (chunk size, page size, timeout).
- Đổi protocol → cập nhật **đồng thời** vault, main, và file shared.
- **`tsc` / `vite build` / lint** là tiêu chí tối thiểu trước khi coi task xong — tránh merge “chỉ chạy được trên máy agent”.

---

## Phụ lục — Đường dẫn tham chiếu nhanh

| Khu vực | Đường dẫn |
|---------|-----------|
| UI chính | `main-app/src/App.tsx`, `main-app/src/components/` |
| Message + ký | `main-app/src/messaging/messageBus.ts`, `shared/vaultProtocol.ts` |
| Iframe vault | `data-vault/src/main.ts` |
| Worker | `data-vault/src/worker/vault.worker.ts`, `data-vault/src/worker/workerProxy.ts` |
| Contract domain | `main-app/src/shared/protocol.ts` |

---

*Tài liệu phản ánh trạng thái codebase tại thời điểm cập nhật; khi đổi kiến trúc, nên điều chỉnh mục 1–2 cho khớp thực tế.*
