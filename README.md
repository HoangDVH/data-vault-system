# Data Vault System

Ứng dụng demo gồm **main-app** (React — UI tìm kiếm, phân trang, bulk) và **data-vault** (iframe — Web Worker giữ dữ liệu in-memory), giao tiếp qua **`postMessage`** với giao thức có ký chung trong **`shared/vaultProtocol.ts`**.

---

## Kiến trúc (tóm tắt)

| Thành phần | Vai trò |
|------------|---------|
| **main-app** | UI, iframe trỏ tới origin vault, `MessageBus` gửi RPC có HMAC |
| **data-vault** | Lọc `postMessage` theo origin cha, forward xuống worker |
| **vault.worker.ts** | Mảng `rows[]` trong RAM; `INIT`, `SEARCH` (phân trang), `BULK_INSERT` (chunk + yield) |

Chi tiết quyết định kỹ thuật và trade-off: **[DECISION_LOG.md](./DECISION_LOG.md)**.

---

## Yêu cầu

- **Node.js** phiên bản hỗ trợ ES modules (khuyến nghị LTS hiện tại)
- Hai terminal (hoặc chạy nền) vì có **hai Vite dev server** độc lập

---

## Cài đặt & chạy local

Repo có **hai package** riêng, không có `package.json` ở root. Cần `npm install` trong từng thư mục.

### 1. Data Vault (nên chạy trước — thường chiếm cổng **5173**)

```bash
cd data-vault
npm install
npm run dev
```

Mặc định Vite dùng `http://localhost:5173` nếu cổng còn trống.

### 2. Main App (thường **5174** nếu 5173 đã bị vault dùng)

```bash
cd main-app
npm install
npm run dev
```

Mở trình duyệt tại URL mà terminal main-app in ra (thường **http://localhost:5174**). Iframe vault dùng `VITE_VAULT_ORIGIN` (mặc định `http://localhost:5173`) — hai origin phải khớp với **thực tế** cổng bạn đang chạy.

---

## Biến môi trường

Sao chép và điền:

- `main-app/.env.example` → `main-app/.env`
- `data-vault/.env.example` → `data-vault/.env`

| Biến | Package | Ý nghĩa |
|------|---------|---------|
| `VITE_VAULT_ORIGIN` | main-app | Origin của app vault (iframe `src`), ví dụ `http://localhost:5173` |
| `VITE_VAULT_SHARED_SECRET` | **cả hai** | Chuỗi dùng chung cho HMAC; để trống thì dev dùng fallback trong code (không dùng cho production) |
| `VITE_ALLOWED_PARENT_ORIGINS` | data-vault | Danh sách origin được phép embed iframe (cha), ví dụ `http://localhost:5174` |
| `VITE_VAULT_PROTOCOL_DEBUG` | (optional) | `true` để log lỗi verify protocol |

Hai app phải dùng **cùng** `VITE_VAULT_SHARED_SECRET` nếu bạn set giá trị tường minh.

---

## Scripts

### main-app

| Lệnh | Mô tả |
|------|--------|
| `npm run dev` | Dev server Vite |
| `npm run build` | `tsc -b` + `vite build` |
| `npm run lint` | ESLint |
| `npm run preview` | Preview bản build |

### data-vault

| Lệnh | Mô tả |
|------|--------|
| `npm run dev` | Dev server Vite |
| `npm run build` | `tsc` + `vite build` |
| `npm run preview` | Preview bản build |

---

## Cấu trúc thư mục (gợi ý)

```
data-vault-system/
├── main-app/          # UI React
├── data-vault/        # Iframe + worker
├── shared/            # vaultProtocol — import từ cả hai app
├── DECISION_LOG.md
└── README.md
```

---

## Ghi chú triển khai

- Dữ liệu hoạt động trong **worker** (`rows[]`). Sau **bulk insert**, snapshot được lưu **IndexedDB** (trong worker); reload iframe vẫn thấy các dòng đã bulk. Seed demo 500k từ `INIT` không ghi disk — reload sẽ generate lại giống lần đầu nếu chưa từng bulk (hoặc đã xóa dữ liệu site).
- Deploy hai app lên hai URL khác nhau: cập nhật `VITE_VAULT_ORIGIN`, `VITE_ALLOWED_PARENT_ORIGINS`, và secret production.

---

*Tài liệu này phản ánh cách chạy và cấu trúc repo tại thời điểm viết; cổng dev có thể thay đổi theo thứ tự bạn khởi động Vite.*
