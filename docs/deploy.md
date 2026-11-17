# Deploy miễn phí (demo)

Bố cục, tất cả đều gói free:

| Thành phần | Nơi chạy | Ghi chú |
| :--- | :--- | :--- |
| Storefront (Next.js) | Vercel Hobby | Tự deploy khi push (Git integration) |
| Medusa backend + admin | Render Web Service free | `render.yaml`, ngủ sau 15 phút không có request |
| realtime-gateway (Socket.io) | Render Web Service free | cùng Blueprint |
| Redis | Render Key Value free | 25 MB, không lưu xuống đĩa, chỉ truy cập nội bộ Render |
| Postgres `medusa_db` + `ai_db` | Neon free | có pgvector, không hết hạn (Render Postgres free hết hạn sau 30 ngày) |
| AI service (FastAPI, bge-m3) | Hugging Face Spaces (Docker, CPU free) | 16 GB RAM, Render 512 MB không đủ cho torch + bge-m3 |

CI chạy trên GitHub Actions ở cả 3 repo (`.github/workflows/ci.yml`) cho push và PR vào `dev`/`main`.
CD: Vercel và Render tự deploy khi `main` thay đổi; repo AI đẩy code sang Space bằng `deploy-hf.yml`.

## 1. Neon (Postgres)

1. Tạo project trên neon.tech, region Singapore. Tạo 2 database: `medusa_db` và `ai_db`.
2. Trong `ai_db` chạy `CREATE EXTENSION IF NOT EXISTS vector;`.
3. Lấy connection string **direct** (không phải pooler), dạng
   `postgresql://<user>:<pass>@<host>.neon.tech/medusa_db?sslmode=require`.
4. Chuyển dữ liệu demo đang có ở máy lên Neon (giữ nguyên catalog, công thức, embedding):

   ```shell
   # medusa_db (container Postgres của backend, xem README)
   docker exec <medusa-container> pg_dump -U <user> -d medusa-backend --no-owner --no-acl > medusa.sql
   psql "<neon medusa_db url>" -f medusa.sql

   # ai_db (container grocery-ai-db của repo AI)
   docker exec grocery-ai-db pg_dump -U ai_user -d ai_db --no-owner --no-acl > ai.sql
   psql "<neon ai_db url>" -f ai.sql
   ```

   Không muốn dump thì chạy migrate + seed thẳng vào Neon: đặt `DATABASE_URL` trong `apps/backend/.env`
   thành URL Neon rồi `cd apps/backend && npx medusa db:migrate && npm run seed`.

Gói free 0,5 GB mỗi project. Nếu hai DB cộng lại vượt thì tách `ai_db` sang project thứ hai.

## 2. Render (backend + gateway + Redis)

1. render.com > New > **Blueprint** > chọn repo `grocery-store-backend` (nhánh `main`). Render đọc `render.yaml`.
2. Điền các biến `sync: false` khi được hỏi:

   | Biến | Giá trị |
   | :--- | :--- |
   | `DATABASE_URL` | URL Neon của `medusa_db` |
   | `MEDUSA_BACKEND_URL` | `https://com4fud-backend.onrender.com` (URL thật Render cấp) |
   | `STORE_CORS` | `https://<storefront>.vercel.app` |
   | `ADMIN_CORS` | giống `MEDUSA_BACKEND_URL` |
   | `AUTH_CORS` | `MEDUSA_BACKEND_URL,STORE_CORS` |
   | `STOREFRONT_URL` | giống `STORE_CORS` |
   | `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | key sandbox (backend không khởi động nếu thiếu) |
   | `VNPAY_RETURN_URL` | `https://<storefront>.vercel.app/vn/checkout/vnpay-return` |
   | `AI_SERVICE_URL` | `https://<user>-<space>.hf.space` |
   | `AI_INTERNAL_KEY` | chuỗi ngẫu nhiên, đặt giống ở Space |
   | `STORE_CORS` (gateway) | `https://<storefront>.vercel.app` |

   Lần đầu chưa có URL storefront thì điền tạm, deploy Vercel xong quay lại sửa rồi **Manual Deploy**
   (`MEDUSA_BACKEND_URL` được đóng vào admin lúc build nên đổi nó phải build lại).
3. Mở `https://<backend>/health` thấy `OK`, admin ở `https://<backend>/app`.
4. Lấy publishable key: admin > Settings > Publishable API Keys (gắn với sales channel mặc định).

Giới hạn cần biết: RAM 512 MB (đã đặt `--max-old-space-size=460`), file upload lưu ở đĩa tạm nên mất khi
redeploy, mỗi workspace có 750 giờ chạy free mỗi tháng (tính chung mọi service).

## 3. Pinger giữ backend thức

`.github/workflows/keep-alive.yml` gọi các URL trong variable `PING_URLS` mỗi 10 phút,
từ 06:00 tới 23:59 giờ VN (~560 giờ/tháng, còn dư cho gateway).

1. Repo backend > Settings > Secrets and variables > Actions > **Variables** > New:
   `PING_URLS` = `https://<backend>/health https://<user>-<space>.hf.space/api/v1/health`
   (ping cả Space để nó không ngủ sau 48 giờ; Space không tính vào giờ Render).
2. Workflow chỉ chạy theo lịch trên nhánh mặc định, nên cần merge PR vào `main` trước.
   Thử ngay: Actions > Keep alive > Run workflow.

Không ping gateway: ping 24/7 cả hai service sẽ vượt 750 giờ. Gateway ngủ thì lần kết nối đầu mất ~1 phút để dậy,
Socket.io client tự kết nối lại. Hôm demo có thể thêm URL gateway vào `PING_URLS` tạm thời.

## 4. Vercel (storefront)

1. vercel.com > Add New > Project > import `grocery-store-frontend`, Production Branch = `main`.
2. Environment Variables:

   | Biến | Giá trị |
   | :--- | :--- |
   | `MEDUSA_BACKEND_URL` | URL backend Render |
   | `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | key ở bước 2.4 |
   | `NEXT_PUBLIC_BASE_URL` | `https://<storefront>.vercel.app` |
   | `NEXT_PUBLIC_DEFAULT_REGION` | `vn` |
   | `NEXT_PUBLIC_UI_MOCK` | `false` |
   | `NEXT_PUBLIC_REALTIME_URL` | `https://com4fud-realtime.onrender.com` |
   | `REVALIDATE_SECRET` | chuỗi ngẫu nhiên |

3. Build của Next gọi backend để dựng sẵn trang sản phẩm, nên mở `/health` của backend cho nó dậy
   trước khi bấm Deploy (hoặc để pinger chạy).

## 5. Hugging Face Space (AI service)

1. huggingface.co > New Space > SDK **Docker** (Blank), hardware CPU basic (free). Tên ví dụ `com4fud-ai`.
2. Space > Settings > **Variables and secrets**:
   `AI_DB_HOST`, `AI_DB_PORT=5432`, `AI_DB_NAME=ai_db`, `AI_DB_USER`, `AI_DB_PASSWORD` (secret),
   `PGSSLMODE=require` (Neon bắt buộc SSL), `GEMINI_API_KEY` (secret), `AI_INTERNAL_KEY` (secret, giống backend),
   cùng các biến `AI_*` khác nếu cần (xem `.env.example` của repo AI).
3. Upload model "Mua lại" một lần (không có trong GitHub):

   ```shell
   pip install huggingface_hub
   hf auth login
   hf upload <user>/com4fud-ai weights/lgbm_v4_selected.onnx weights/lgbm_v4_selected.onnx --repo-type space
   ```

4. Repo `grocery-store-ai` trên GitHub: secret `HF_TOKEN` (token write), variable `HF_SPACE` = `<user>/com4fud-ai`.
   Push lên `main` (hoặc Actions > Deploy to Hugging Face > Run workflow) để đẩy code; Space tự build Docker.
5. Kiểm: `https://<user>-com4fud-ai.hf.space/api/v1/health` báo cả `chef` và `reorder` là `ok`.
