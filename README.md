<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa DTC Starter
</h1>

<h4 align="center">
  <a href="https://docs.medusajs.com">Documentation</a> |
  <a href="https://www.medusajs.com">Website</a>
</h4>

<p align="center">
  Building blocks for digital commerce
</p>
<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/develop/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Medusa is released under the MIT license." />
  </a>
  <a href="https://circleci.com/gh/medusajs/medusa">
    <img src="https://circleci.com/gh/medusajs/medusa.svg?style=shield" alt="Current CircleCI build status." />
  </a>
  <a href="https://github.com/medusajs/medusa/blob/develop/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
    <a href="https://www.producthunt.com/posts/medusa"><img src="https://img.shields.io/badge/Product%20Hunt-%231%20Product%20of%20the%20Day-%23DA552E" alt="Product Hunt"></a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>

# Medusa DTC Starter

A production-ready monorepo starter for direct-to-consumer ecommerce stores powered by Medusa and Next.js. Includes a fully featured storefront with product browsing, cart, checkout, customer accounts, and order management.

## Features

- All of [Medusa's commerce features](https://docs.medusajs.com/resources/commerce-modules)
- Multi-region support with automatic country detection
- Product catalog with variant selection
- Cart with promotion codes
- Multi-step checkout with shipping and payment
- Customer accounts with order history and address management
- Order transfer between accounts

## Getting Started

### Deploy with Medusa Cloud

The fastest way to get started is deploying with [Medusa Cloud](https://cloud.medusajs.com):

1. [Create a Medusa Cloud account](https://cloud.medusajs.com)
2. Deploy this starter directly from your dashboard

### Local Installation

> **Prerequisites:
>
> - [Node.js](https://nodejs.org/) v20+
> - [PostgreSQL](https://www.postgresql.org/) v15+
> - [pnpm](https://pnpm.io/) v10+

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/medusajs/dtc-starter.git
cd dtc-starter
pnpm install
```

2. Set up environment variables for the backend:

```bash
cp apps/backend/.env.template apps/backend/.env
```

3. Set the database URL in `apps/backend.env`:

```bash
# Replace with actual database URL, make sure the database exists.
DATABASE_URL=postgres://postgres:@localhost:5432/medusa-dtc-starter
```

4. Run migrations:

```bash
cd apps/backend
pnpm medusa db:migrate
```

5. Add admin user:

```bash
cd apps/backend
pnpm medusa user -e admin@test.com -p supersecret
```

6. Start Medusa backend:

```bash
cd apps/backend
pnpm dev
```

7. Open the admin dashboard at `localhost:9000/app` and log in. Retrieve your publishable API key at Settings > Publishable API key.

8. Set up environment variables for the storefront:

```bash
cp apps/storefront/.env.template apps/storefront/.env.local
```

9. Update `apps/storefront/.env.local` with your Medusa publishable API key:

```bash
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_6c3...
```

10.  Start storefront:

```bash
cd apps/storefront
pnpm dev
```

The storefront runs on `http://localhost:8000`.

You can slo run the following command from the root to start both backend and storefront:

```bash
pnpm dev
```

## Configuration

The storefront is configured via environment variables in `apps/storefront/.env.local`:

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable API key from your Medusa backend | — |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | URL of your Medusa backend | `http://localhost:9000` |
| `NEXT_PUBLIC_DEFAULT_REGION` | Default region country code | `dk` |
| `NEXT_PUBLIC_BASE_URL` | Base URL of the storefront | `https://localhost:8000` |
| `NEXT_PUBLIC_STRIPE_KEY` | Stripe publishable key (optional) | — |

## Seed

`npm run seed --workspace=@dtc/backend` dựng khung cửa hàng Com4Fud: region "Việt Nam" (VND, quốc gia `vn`), kho "Kho Q.7", phương thức "Giao tận nhà" (15.000đ) và in publishable key cho storefront. Script idempotent: chạy lại không nhân đôi bản ghi và không xoá gì.

Lưu ý:
- Script **không dọn dữ liệu cũ**. Medusa 2.21.1 không có lệnh `db:reset`. Nếu DB dev còn dữ liệu Europe/quần áo từ bản seed cũ (`initial-data-seed.ts`, đã xoá), xoá và tạo lại DB (mất toàn bộ dữ liệu, kể cả user admin), rồi migrate, tạo admin và seed:
  ```bash
  # Postgres chạy trong Docker (tên container/DB theo máy bạn)
  docker exec com4fud-postgres psql -U postgres -c 'DROP DATABASE "medusa-backend" WITH (FORCE)' -c 'CREATE DATABASE "medusa-backend"'
  cd apps/backend
  npx medusa db:migrate
  npx medusa db:migrate:search
  npx medusa user -e <email> -p <mật khẩu>
  npm run seed --workspace=@dtc/backend   # chạy từ gốc repo
  ```
- Medusa tự tạo "Medusa Store", "Default Sales Channel" và một publishable key khi khởi động; seed dùng lại các thứ này (đặt tiền tệ mặc định VND) thay vì tạo trùng.
- Publishable key gắn với từng DB: sau mỗi lần xoá và tạo lại DB, chép key mới (dòng `Publishable key:` khi seed) vào `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` trong `.env.local` của storefront rồi chạy lại `yarn dev`.

### Catalog

`npm run seed` nạp **catalog v2**: 2.129 sản phẩm, 11 danh mục (`apps/backend/src/lib/seed/seed-data/catalog-v2.json`). Integration test vẫn dùng bộ 32 món trong `seed-data/catalog.ts` (mặc định của `seedCatalog`).

- **DB đã seed catalog cũ (32 món) phải xoá và seed lại** theo lệnh ở trên. Seed bỏ qua sản phẩm đã có theo handle và chỉ tạo price list "Khuyến mãi tuần" khi chưa có, nên seed chồng lên DB cũ sẽ còn 32 món cũ và thiếu giá khuyến mãi của catalog v2. Sửa giá, tên hay ẩn/hiện của sản phẩm đã seed cũng cần seed lại trên DB mới.
- Seed 2.129 món mất khoảng 15 phút. Log có nhiều dòng `not_found` của search ingestion: index tìm kiếm chưa có version active nên bỏ qua event; khởi động app (`npm run backend:dev`) một lần thì index tự nạp đủ.
- JSON sinh từ `catalog_v2_updated.xlsx` (thư mục `data/` của nhóm, ngoài repo). Sửa dữ liệu thì sửa xlsx rồi chạy (Python 3.11+, `pandas`, `openpyxl`):
  ```bash
  python tools/catalog/build_catalog_v2.py <đường dẫn>/catalog_v2_updated.xlsx [thư mục chứa recipes_v2.json]
  ```
  Script in báo cáo (dòng bị ẩn, đổi tên, giá nghi sai, thiếu quy cách) và sinh lại `tools/catalog/hidden-products.md`. Quy tắc ánh xạ danh mục, ẩn sản phẩm, tồn kho và giá khuyến mãi ở docstring đầu script.
- Sản phẩm có `note_2` trong xlsx hoặc trùng tên và quy cách với sản phẩm khác được seed với `status = draft`: vẫn có trong DB (`sku = catalog_id`, để AI tra được) nhưng storefront và tìm kiếm không thấy.

### Khách, admin và đơn demo

Đặt `DEMO_PASSWORD` trong `apps/backend/.env` (mật khẩu chung, không commit) rồi chạy `npm run seed`; thiếu biến này thì seed bỏ qua phần demo. Dữ liệu ở `apps/backend/src/lib/seed/seed-data/demo.ts`.

| Tài khoản | Vai trò |
| :--- | :--- |
| `hoangnam@com4fud.demo` | Admin (`http://localhost:9000/app`) |
| `minhthu@com4fud.demo` | Khách, nhóm "Thành viên", 2 địa chỉ ở Quận 7, 7 đơn |
| `khachmoi@com4fud.demo` | Khách mới, chưa có đơn, không thuộc nhóm |

7 đơn của `minhthu` (mã ở `metadata.code`): 5 đơn theo mock (`C4F-261007-0142` SHIPPING, 3 đơn DELIVERED, `C4F-260924-0207` CANCELLED), `C4F-DEMO-PENDING` để thử khách huỷ đơn và `C4F-DEMO-PREPARING` để thử nút "Bắt đầu giao" trong Admin. Mỗi đơn đi đúng các bước Medusa của stage đó (giữ hàng, đã thanh toán, fulfillment, shipment, đã giao).

- Thanh toán của đơn demo dùng provider hệ thống `pp_system_default` (đánh dấu đã trả), không phải VNPAY, nên huỷ đơn demo không gọi API hoàn tiền VNPAY.
- `created_at` của đơn là lúc seed (`createOrderWorkflow` không nhận ngày tạo); ngày đặt theo mock nằm trong `metadata.stage_log`.
- Thử huỷ đơn hoặc "Bắt đầu giao" sẽ đổi đơn demo; muốn có lại đơn ban đầu thì xoá và seed lại DB.

## Thanh toán VNPAY (sandbox)

Region "Việt Nam" chỉ có một phương thức thanh toán: VNPAY (`pp_vnpay_vnpay`, code ở `apps/backend/src/modules/vnpay`).

- Điền `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET` (nhận qua email đăng ký sandbox.vnpayment.vn) vào `apps/backend/.env`; `VNPAY_PAY_URL`, `VNPAY_RETURN_URL` xem `.env.template`. **Thiếu hai biến đầu thì backend không khởi động** (provider kiểm tra options). Không commit `.env`.
- **IPN** là `GET /hooks/vnpay/ipn` và cần một URL công khai HTTPS. Khi dev dùng tunnel (ví dụ cloudflared hoặc ngrok trỏ tới cổng 9000), rồi khai báo `https://<tunnel>/hooks/vnpay/ipn` trong cổng sandbox VNPAY (mục cấu hình IPN URL của merchant). Return URL chỉ để hiển thị, không đổi trạng thái đơn.
- `npm run seed` cập nhật region đang có (DB cũ còn `pp_system_default`) sang chỉ còn VNPAY.

## Resources

- [Medusa Documentation](https://docs.medusajs.com)
- [Medusa Cloud](https://cloud.medusajs.com)
