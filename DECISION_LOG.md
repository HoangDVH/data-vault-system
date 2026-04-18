# DECISION_LOG — Data Vault System

Tài liệu này ghi lại **lựa chọn kỹ thuật**, **tối ưu hiệu năng**, và **phần được hỗ trợ bởi AI** trong dự án *data-vault-system* (ứng dụng chính `main-app` + iframe `data-vault`).

---

## 1. Technical choices — Kiến trúc và công nghệ

### Tách Main app và Data Vault (iframe)

- **Main app** (thường Vite `:5174`) chứa UI React: ô tìm kiếm, filter Min/Max ID, bảng ảo hóa, phân trang, bulk insert.
- **Data vault** (thường `:5173`) chạy trong **iframe ẩn**, giữ **worker** và toàn bộ dữ liệu nặng trong ngữ cảnh vault.

**Lý do:**

- Cô lập **origin** khác nhau (`localhost:5173` vs `localhost:5174`): trình duyệt áp dụng Same-Origin Policy; dữ liệu lớn và logic xử lý nằm trong vault, UI chỉ nhận **payload nhỏ** qua messaging.
- Giao tiếp **chỉ qua `postMessage`**, có kiểm tra **origin** phía vault (`ALLOWED_PARENT_ORIGINS`) để không nhận message từ trang lạ.

### Wire protocol (`shared/vaultProtocol.ts`)

- Phiên bản giao thức **`PROTOCOL_VERSION`**, tin nhắn có **timestamp** và cửa sổ **`TIMESTAMP_MAX_SKEW_MS`** chống replay / lệch đồng hồ.
- **HMAC-SHA256** ký request/response khi có shared secret (`VITE_VAULT_SHARED_SECRET`), payload được **validate** theo từng loại (`INIT`, `SEARCH`, `BULK_INSERT`, …).

**Lý do:** Tin nhắn iframe không đi qua HTTPS “API” riêng; ký + kiểm tra payload giảm rủi ro giả mạo và input không hợp lệ.

### Worker cho dữ liệu và RPC

- File `data-vault/src/worker/vault.worker.ts` giữ **mảng dòng** trong memory, xử lý **`INIT`**, **`SEARCH`**, **`BULK_INSERT`**.
- Proxy Promise-based (`workerProxy.ts`) bridge giữa main thread của iframe và worker.

**Lý do:** JS chạy trên thread chính của iframe vẫn có thể block UI nhỏ của vault; worker giữ **CPU** và **bộ nhớ** tập trung, UI iframe vẫn có thể phản hồi message bus.

### Hợp đồng domain (`main-app/src/shared/protocol.ts`)

- **`User`**, **`SearchPayload`** (keyword, filters, requestId, page, pageSize), **`SearchResponse`** (rows + `totalMatches` + meta phân trang), **`BulkInsertResponse`**.

**Lý do:** Một nguồn type cho UI và tin nhắn; worker vault mirror logic tương thích.

### UI React

- **`@tanstack/react-virtual`**: chỉ render **hàng trong viewport** của trang hiện tại → scroll mượt với danh sách lớn trên một “trang” dữ liệu.
- **`startTransition`** trong `useSearch`: cập nhật state sau khi có response để React ưu tiên input / cảm giác phản hồi.
- **Debounce** ô tìm kiếm (timer `setTimeout`, không ép `await search` trong `finally` của bulk để tránh kẹt trạng thái).

---

## 2. Optimization — Vấn đề hiệu năng và cách xử lý

### Tìm kiếm / filter trên tập rất lớn

| Vấn đề | Cách xử lý |
|--------|------------|
| Trả về quá nhiều row một lần làm payload và React nặng | **`SEARCH` phân trang**: worker quét một pass, đếm **`totalMatches`** và chỉ đẩy **`rows` của một trang** (`page`, `pageSize`, giới hạn server ví dụ max 200). |
| So khớp tên | Chuẩn hóa **`nameLc`** (lowercase) khi generate để **`includes`** không gọi `toLowerCase` lặp lại hàng triệu lần không cần thiết trên string gốc mỗi lần so (đã lưu sẵn field phụ). |
| Min/Max ID | Lọc theo khoảng ID **trước** khi kiểm tra keyword → giảm chi phí không cần thiết khi filter hẹp. |

### Bulk insert (ví dụ +50k)

| Vấn đề | Cách xử lý |
|--------|------------|
| Một vòng lặp đồng bộ quá dài block worker / message queue | **Chunk** `BULK_SLICE` (ví dụ 16k), sau mỗi slice **`await setTimeout(0)`** nhường event loop — cho phép xen kẽ **`SEARCH`** hoặc message khác. |
| UI “Bulk…” kẹt | **`finally`** clear `bulkWorking` **trước** khi gọi `search()` fire-and-forget; timeout **`SEARCH`** đủ dài (ví dụ 60s) so với tìm trên tập lớn. |

### Tránh race condition khi gõ nhanh

- **`requestId`** trên mỗi lần `SEARCH`; chỉ áp dụng kết quả nếu **`latestRequestId`** trùng — tránh hiển thị kết quả cũ khi request mới đã xong trước.

### Layout / UX

- Viewport cố định (`html/body/#root` height + overflow), scroll chỉ trong vùng bảng → không “double scroll” toàn trang.
- Toast / phân trang / thanh công cụ được tinh chỉnh để không làm layout nhảy không cần thiết.

---

## 3. AI usage & critical thinking — Phần được AI hỗ trợ

Phần này mô tả **trung thực** vai trò của công cụ AI (ví dụ Cursor Agent) trong repo, để đánh giá được **phần suy luận của người** vs **phần sinh code / refactor**.

### Việc AI thường làm tốt

- **Boilerplate & wiring**: component React, hook `useSearch`, `PaginationBar`, `Toast`, class Tailwind đồng bộ với design hiện có.
- **Điều tra nhanh**: trace `postMessage`, origin, timeout, luồng bulk → insert đúng file (`main.ts`, `messageBus`, worker).
- **Đồng bộ protocol**: thêm field `page` / `pageSize`, cập nhật `validateWirePayload`, worker và client cùng lúc.

### Việc người vẫn phải kiểm tra (critical thinking)

- **Bảo mật thật**: secret trong `.env`, không commit; production cần review HMAC, CORS/origin, rate limit — AI chỉ phản ánh **policy** đã mô tả trong code.
- **Độ phức tạp thuật toán**: phân trang bằng một pass là đủ cho demo; với **full-text index** hoặc **server-side DB** thì kiến trúc sẽ khác — quyết định business/architecture là của người.
- **Kiểm thử tay**: hai dev server (5173 + 5174), secret khớp, bulk 50k, filter, phân trang — cần chạy thực tế.

### Nguyên tắc khi dùng AI trong dự án này

- Giữ **DECISION_LOG** và comment ngắn ở chỗ **trade-off** (chunk size, page size, timeout).
- Mọi thay đổi protocol **phải** cập nhật cả vault và main + file shared.
- Không merge logic “chỉ chạy trên máy AI”; **build** (`tsc`, `vite build`) và **lint** là chuẩn tối thiểu trước khi coi là xong.

---

## Phụ lục — Cấu trúc thư mục gợi nhớ

| Khu vực | Đường dẫn gợi ý |
|---------|------------------|
| UI chính | `main-app/src/App.tsx`, `components/` |
| Message + ký | `main-app/src/messaging/messageBus.ts`, `shared/vaultProtocol.ts` |
| Iframe vault | `data-vault/src/main.ts` |
| Worker | `data-vault/src/worker/vault.worker.ts`, `workerProxy.ts` |
| Contract domain | `main-app/src/shared/protocol.ts` |

---

*Tài liệu phản ánh trạng thái codebase tại thời điểm tạo file; khi đổi kiến trúc, nên cập nhật mục 1–2 cho khớp thực tế.*
