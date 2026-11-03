# Com4Fud Backend

Medusa 2.21.1 backend for **Com4Fud**, a Vietnamese grocery dark store (one brand, warehouse "Kho Q.7" in District 7, Ho Chi Minh City). Built for the MSIS4133 course project, team 05.

Medusa handles the commerce core (catalog, prices, cart, orders, inventory, auth, admin). This repo adds:

- VND region, a 2,129-product grocery catalog in 11 categories, demo customers and orders
- Product search with "in stock" and "on sale" filters (Medusa Search, Postgres provider)
- Delivery time slots with a flat 15,000đ fee
- VNPAY as the only payment provider (signed payment URL, IPN, refunds)
- Vouchers and a customer voucher wallet
- Order stages (`PENDING → CONFIRMED → PREPARING → SHIPPING → DELIVERED`, or `CANCELLED`) driven by Medusa events, customer cancel with refund, "start delivery" with driver and ETA
- "Buy it again" basket (frequency-based placeholder for the LightGBM module) and the kitchen assistant contract (routes return 501 until the AI service is connected)
- Admin widgets: summary, low stock, delivery

The storefront lives in a separate repo (`grocery-store-frontend`, port 8000). The API contract both sides follow is section 3 of [`docs/plans/2026-10-18-sync-ui-v2-backend.md`](docs/plans/2026-10-18-sync-ui-v2-backend.md).

## Repository layout

```text
apps/backend/
  src/api/            custom routes and middlewares.ts (body validation, auth, allowed fields)
  src/workflows/      one workflow per feature; routes only run workflows
  src/subscribers/    order stage subscribers
  src/modules/vnpay/  VNPAY payment provider
  src/modules/hot-stock/  Redis stock holds before payment (in progress)
  src/search/         product search index (in_stock, VND prices)
  src/lib/            plain functions with unit tests (stages, slots, vouchers, ETA, reorder, dashboard)
  src/lib/seed/       store bootstrap, catalog, promotions, demo data
  src/admin/          admin widgets and Vietnamese labels
  integration-tests/  HTTP integration tests
docs/contracts/       verified Medusa API facts, assistant contract and fixtures
docs/plans/           task plan and API contract
tools/                Python scripts that build seed data and contract fixtures
```

## Getting started

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0`
- npm 10.9.8 (pinned in `package.json`). Newer npm works for running scripts; use `npx npm@10.9.8 install ...` when adding packages so the lockfile stays stable.
- Docker (PostgreSQL 16 with pgvector, Redis Stack 7.2)
- Python 3.11+ with `pandas` and `openpyxl`, only if you rebuild the catalog data

### 1. Install

```bash
git clone https://github.com/Prosperum26/grocery-store-backend.git
cd grocery-store-backend
npm install
```

### 2. Start PostgreSQL

```bash
docker run -d --name com4fud-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=medusa-backend \
  -p 5434:5432 -v com4fud-pgdata:/var/lib/postgresql/data --restart unless-stopped \
  pgvector/pgvector:pg16
```

After a reboot: `docker start com4fud-postgres`.

### 2b. Start Redis

The hot-stock module holds stock in Redis before payment; the backend does not start without it.

```bash
docker run -d --name com4fud-redis -p 6379:6379 -e REDIS_ARGS="--appendonly yes" \n  -v com4fud-redisdata:/data --restart unless-stopped redis/redis-stack-server:7.2.0-v10
```

After a reboot: `docker start com4fud-postgres com4fud-redis`. Integration tests use the same Redis with the key prefix `c4f-test:`.

### 3. Environment

```bash
cp apps/backend/.env.template apps/backend/.env
cp apps/backend/.env.test.template apps/backend/.env.test
```

In `apps/backend/.env` set at least:

| Variable | Value |
| :--- | :--- |
| `DATABASE_URL` | `postgres://postgres:<password>@localhost:5434/medusa-backend` |
| `REDIS_URL` | `redis://localhost:6379` (the default when unset) |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | Sandbox credentials, or dummy values such as `TESTTMN1` / `test-hash-secret-not-real`. **The backend does not start without them.** |
| `DEMO_PASSWORD` | Shared password of the demo accounts; leave empty to skip demo data |

In `apps/backend/.env.test` set `DB_PORT=5434` and `DB_PASSWORD`; the test runner creates temporary databases on that server. Never commit `.env` or `.env.test`.

### 4. Migrate, seed, run

```bash
cd apps/backend
npx medusa db:migrate
cd ../..
npm run seed --workspace=@dtc/backend     # about 15 minutes for 2,129 products
npm run backend:dev                       # http://localhost:9000, admin at /app
```

- The first `backend:dev` on a new database activates the search index and loads every product into it, which takes a few minutes. Until then `/store/search` returns errors, and seeding logs many harmless `not_found` lines from search ingestion.
- Seeding prints the **publishable key**. Put it in `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in the storefront's `.env.local` and restart the storefront. The key belongs to the database, so it changes whenever you recreate the database.
- Admin user without demo data: `npx medusa user -e <email> -p <password>` in `apps/backend`.

### 5. Tests and type check

```bash
npm run test:unit --workspace=@dtc/backend
npm run test:integration:http --workspace=@dtc/backend   # needs the Postgres container, about 6 minutes
cd apps/backend && npx tsc --noEmit
```

The scripts use `cross-env`, so they run from PowerShell, cmd or bash. `tsc` reports errors on a fresh clone until the app has run once, because `tsconfig.json` includes the types Medusa generates in `.medusa/types`.

## Seed data

`npm run seed` is idempotent: records are looked up by handle, email or code, and existing ones are skipped. It never updates or deletes, so **changing the price, name or visibility of seeded products means recreating the database**:

```bash
docker exec com4fud-postgres psql -U postgres -c 'DROP DATABASE "medusa-backend" WITH (FORCE)' -c 'CREATE DATABASE "medusa-backend"'
cd apps/backend && npx medusa db:migrate && cd ../..
npm run seed --workspace=@dtc/backend
```

Recreating the database removes every admin user, the publishable key and admin layout settings.

### Store

Region "Việt Nam" (VND, country `vn`), stock location "Kho Q.7", shipping option "Giao tận nhà" at 15,000đ, and VNPAY as the only payment provider. Medusa's own "Default Sales Channel" and publishable key are reused rather than duplicated.

### Catalog

`apps/backend/src/lib/seed/seed-data/catalog-v2.json`: 2,129 products in 11 categories, one variant each, `sku` = `catalog_id` (the id the AI service uses). Integration tests use the 32-product fixture in `seed-data/catalog.ts`, which is the default of `seedCatalog`.

The JSON is generated from the team's `catalog_v2_updated.xlsx` (kept outside the repo):

```bash
python tools/catalog/build_catalog_v2.py <path>/catalog_v2_updated.xlsx [folder with recipes_v2.json]
```

The script prints a report (hidden rows, renames, suspicious prices, missing units) and regenerates [`tools/catalog/hidden-products.md`](tools/catalog/hidden-products.md). Its docstring lists the rules for categories, hidden products, stock and sale prices. Products flagged in the `note_2` column, and exact duplicates, are seeded as `draft`: they stay in the database so AI lookups by `catalog_id` work, but the storefront and search never show them. Prices come from the team's estimate script, not market data. Product images are not part of the seed yet.

### Demo accounts and orders

Created when `DEMO_PASSWORD` is set. Data: `apps/backend/src/lib/seed/seed-data/demo.ts`.

| Account | Role |
| :--- | :--- |
| `hoangnam@com4fud.demo` | Admin |
| `minhthu@com4fud.demo` | Customer in the "Thành viên" group, two District 7 addresses, 7 orders |
| `khachmoi@com4fud.demo` | New customer, no orders, no group |

`minhthu`'s orders (display code in `metadata.code`): five from the storefront mock (`C4F-261007-0142` SHIPPING, three DELIVERED, `C4F-260924-0207` CANCELLED), plus `C4F-DEMO-PENDING` to try customer cancel and `C4F-DEMO-PREPARING` to try "start delivery". Each order goes through the Medusa steps of its stage (reservation, payment, fulfillment, shipment, delivery).

- Demo orders are paid through the system provider `pp_system_default`, not VNPAY, so cancelling one does not call the VNPAY refund API.
- `created_at` is the seeding time (`createOrderWorkflow` takes no creation date); the mock dates are in `metadata.stage_log`.
- Trying cancel or start delivery changes the demo orders; recreate the database to get them back.

### Vouchers

`TUOI20` (20,000đ off orders from 150,000đ, public), `THANHVIEN15` (15,000đ, "Thành viên" group only), `HETHAN5` (expired). A code that does not meet its conditions still returns 200 when applied to a cart, so the storefront must read `discount_total` afterwards; only unknown codes return 4xx.

## VNPAY (sandbox)

- Credentials come in the sandbox.vnpayment.vn sign-up email; put them in `apps/backend/.env` only.
- The IPN is `GET /hooks/vnpay/ipn` and needs a public HTTPS URL: in development, run a tunnel (cloudflared or ngrok to port 9000) and register `https://<tunnel>/hooks/vnpay/ipn` in the sandbox portal. Only the IPN changes payment state; `GET /store/vnpay/verify-return` just tells the return page what to show.
- Not yet verified against the real sandbox: the payment signature encoding and the refund API. See `docs/contracts/verified-apis.md` (BE-5a, BE-8).

## Admin

Open `http://localhost:9000/app`.

- **Vietnamese:** the dashboard ships a Vietnamese translation but defaults to English and the default cannot be set from the server. Each user picks **Profile → Language → Tiếng Việt** once per browser (stored in localStorage `lng`). `src/admin/i18n/index.ts` adds the page-customizer labels missing from Medusa's `vi.json`.
- **Widgets:** "Tổng quan" on the order list (`GET /admin/dashboard/summary`), "Sắp cạn kho" on the inventory list (`GET /admin/dashboard/low-stock`), "Giao hàng" in the order detail side column (`POST /admin/orders/:id/start-delivery`).
- **Widget order:** since 2.21, list pages place widgets after the main table even for `*.list.before` zones. To move "Tổng quan" above the orders table: the customize icon (sliders) in the top bar → **Customize page** → drag the block up → save for yourself or **Save for everyone**. Layouts are stored in the database.
- **Colors:** Medusa 2.21.1 has no admin color setting (the colors are hard-coded CSS variables in `@medusajs/dashboard`, and the admin CSS entry is regenerated on every build). Only the team's widgets use Com4Fud accent colors (`src/admin/lib/com4fud.ts`); the rest keeps Medusa's colors.

## Further reading

- [`AGENTS.md`](AGENTS.md): Medusa conventions for this repo
- [`docs/contracts/verified-apis.md`](docs/contracts/verified-apis.md): Medusa 2.21.1 behavior checked by running it, per task
- [`docs/known-risks.md`](docs/known-risks.md): open risks (VNPAY refunds, holds, payment sessions)
- [`docs/contracts/assistant-recipes.md`](docs/contracts/assistant-recipes.md): kitchen assistant and recipe contract
- [Medusa documentation](https://docs.medusajs.com)
