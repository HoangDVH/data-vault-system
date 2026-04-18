# Deploy lên Vercel

Dự án gồm **hai ứng dụng Vite** độc lập:

| App | Vai trò |
|-----|---------|
| `data-vault/` | Trang được nhúng trong iframe (worker + dữ liệu) |
| `main-app/` | UI chính, iframe trỏ tới vault |

Bạn cần **hai project Vercel** (hoặc một project + hai deployment — cách đơn giản nhất là **hai project**).

---

## Bước 1 — Deploy **data-vault** trước

1. Vào [Vercel](https://vercel.com) → **Add New…** → **Project** → Import repo GitHub.
2. **Root Directory**: chọn `data-vault`.
3. Framework: **Vite** (hoặc Other — Build: `npm run build`, Output: `dist`).
4. **Environment Variables** (Production / Preview):

   | Name | Giá trị |
   |------|---------|
   | `VITE_ALLOWED_PARENT_ORIGINS` | Tạm thời có thể để `http://localhost:5174` — **sau khi deploy main-app**, quay lại và thêm URL main, ví dụ: `http://localhost:5174,http://127.0.0.1:5174,https://<main-app>.vercel.app` |
   | `VITE_VAULT_SHARED_SECRET` | Một chuỗi bí mật giống main-app (xem bước 2). |

5. **Deploy**. Copy URL production, ví dụ: `https://data-vault-xxx.vercel.app` (không có `/` ở cuối).

---

## Bước 2 — Deploy **main-app**

1. **Add Project** lần nữa, cùng repo, **Root Directory**: `main-app`.
2. **Environment Variables**:

   | Name | Giá trị |
   |------|---------|
   | `VITE_VAULT_ORIGIN` | Origin vault bước 1, ví dụ `https://data-vault-xxx.vercel.app` |
   | `VITE_VAULT_SHARED_SECRET` | **Cùng giá trị** với vault |

3. Deploy. Copy URL main, ví dụ `https://main-app-yyy.vercel.app`.

---

## Bước 3 — Cập nhật vault cho phép origin main

Vào project **data-vault** trên Vercel → **Settings** → **Environment Variables**:

- Sửa `VITE_ALLOWED_PARENT_ORIGINS` thành danh sách có **đúng URL production** của main-app, ví dụ:

  `http://localhost:5174,http://127.0.0.1:5174,https://main-app-yyy.vercel.app`

- **Redeploy** data-vault (Deployments → … → Redeploy) để bundle nhận biến mới.

Nếu không làm bước này, vault sẽ **chặn postMessage** từ domain main-app production.

---

## Preview branch / PR

Mỗi preview deployment có URL khác. Bạn có hai hướng:

- **Đơn giản**: chỉ test production hai URL cố định.
- **Preview**: thêm URL preview của main vào `VITE_ALLOWED_PARENT_ORIGINS` của vault cho từng nhánh (hoặc dùng [Vercel Environment Variables per branch](https://vercel.com/docs/projects/environment-variables#environments) nếu cần).

---

## Kiểm tra nhanh

1. Mở main-app production trên trình duyệt — status **Connecting** rồi **Ready**.
2. Mở DevTools → **Console** — nếu có lỗi origin/protocol, bật tạm `VITE_VAULT_PROTOCOL_DEBUG=true` trên cả hai app và redeploy.

---

## Biến môi trường cục bộ

Xem `main-app/.env.example` và `data-vault/.env.example`. File `.env` không commit; copy từ `.env.example` khi dev local.
