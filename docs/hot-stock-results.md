# Hot-stock: kết quả đo (HS-7)

Số đo thật trên một máy dev, **không phải** số mục tiêu của proposal. Chạy lại được bằng hai lệnh ở cuối file. Khi chạy trên máy khác hoặc cấu hình khác thì thêm một mục mới, đừng sửa số cũ.

## Môi trường (2026-11-04)

| | |
| :--- | :--- |
| Máy | Intel Core i7-13650HX, 14 luồng, 24 GB RAM, Windows 11 (10.0.26200) |
| Redis | Redis Stack 7.2.4 (`redis/redis-stack-server:7.2.0-v10`) trong Docker Desktop (WSL2), AOF bật, cùng máy |
| Postgres | 16 + pgvector trong Docker, cùng máy |
| Backend | Medusa 2.21.1, Node 24.14.1, **một tiến trình**, event bus và locking in-memory |
| Dữ liệu | Catalog test 32 món, một kho (Kho Q.7), mỗi giỏ 1 món số lượng 1 |

Độ trễ đo từ phía client (`performance.now()` quanh lời gọi), gồm cả đường mạng tới Redis (Docker Desktop) hoặc tới HTTP server trong cùng tiến trình. Phân vị tính theo nearest-rank trên toàn bộ mẫu.

## 1. Tính đúng (H4)

N = 100 yêu cầu cùng lúc tranh S0 = 5 món, lặp 20 lần.

| Cách làm | Mức | Số lượt đúng 5 | Bán mỗi lượt | Bán lố (tổng 20 lượt) | Tồn thấp nhất |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Lua `reserve_hold` | Redis, 20 kết nối | 20/20 | 5 | 0 | 0 |
| GET rồi DECRBY (hai lệnh) | Redis, 20 kết nối | 0/20 | 73–100 | 1.766 | −95 |
| API-14 `POST /store/carts/:id/reserve` | HTTP qua Medusa | 20/20 | 5 (95 lần `409 OUT_OF_STOCK`, 0 lỗi khác) | 0 | 0 |

Vòng đầy đủ qua HTTP (`hot-stock-h4.spec.ts`): 100 giỏ tranh 5 → 5 giỏ giữ được; 3 giỏ trả tiền, 2 giỏ thanh toán lỗi trả hàng; các giỏ thua thử lại thì đúng 2 giỏ giữ được phần vừa trả → **5 đơn**, Postgres `stocked = 5`, `reserved = 5`, Redis `avail = 0`.

Kịch bản lỗi khác (có test riêng, không đo thời gian): thanh toán lỗi trả hàng ngay; IPN lặp không hoàn hai lần; hold hết hạn rồi giữ lại; IPN tới sau khi giỏ khác giữ mất món cuối thì hoàn tiền và không tạo đơn (`hot-stock-ipn.spec.ts`, `hot-stock-lifecycle.spec.ts`, `src/modules/hot-stock/__tests__/hold.spec.ts`).

## 2. Độ trễ

| Phép đo | n | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Redis: giữ hàng giỏ 1 món, gọi lần lượt | 5.000 | 0,526 | 0,752 | 0,884 | 4,769 |
| Redis: giữ hàng giỏ 3 món, gọi lần lượt | 5.000 | 0,544 | 0,770 | 0,899 | 2,433 |
| Redis: trả hàng | 5.000 | 0,548 | 0,773 | 0,906 | 8,814 |
| Redis: `sync_item` | 5.000 | 0,258 | 0,393 | 0,519 | 2,800 |
| Redis: giữ hàng khi 100 yêu cầu tranh nhau (20 kết nối) | 2.000 | 4,361 | 6,807 | 9,055 | 10,696 |
| HTTP API-14, gọi lần lượt | 100 | 13,8 | 15,0 | 16,5 | |
| HTTP API-14, 100 request cùng lúc | 2.000 | 735,8 | 798,5 | 852,7 | 864,3 |

Ghi chú để đọc bảng (nhóm tự diễn giải trong báo cáo):

- Giữ hàng ở mức Redis gồm **hai lượt gửi**: đọc hold cũ (`HGETALL`) rồi chạy script. Giỏ 3 món gần như bằng giỏ 1 món.
- HTTP gọi lần lượt (p95 15 ms) gồm workflow Medusa: hai truy vấn Postgres (giỏ, kho của sales channel) và lời gọi Redis.
- 100 request cùng lúc vào **một tiến trình Node** thì xếp hàng: 100 × khoảng 8 ms ≈ 800 ms. p95 ở đây chủ yếu là thời gian chờ, không phải thời gian xử lý. Muốn giảm thì chạy nhiều tiến trình (Medusa `server` và `worker`) và chuyển locking, event bus sang Redis (HS-9).
- Proposal ghi mục tiêu `< 25 ms` cho route giữ hàng (`docs/02-architecture.md` ở thư mục gốc). Máy này đạt khi gọi lần lượt, không đạt khi 100 request cùng lúc vào một tiến trình. Cần nói rõ điều kiện đo khi so với mục tiêu.

## Đo lại ngày 2026-11-14 (cho báo cáo mục 4.3)

Cùng máy và cấu hình như mục "Môi trường" ở trên, code ở nhánh `dev` commit `c2a169a`. Mỗi phép đo chạy riêng, không chạy song song với phép đo khác.

### Mức Redis (`bench-hot-stock.ts`)

| Phép đo | n | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Giữ hàng giỏ 1 món, gọi lần lượt | 5.000 | 0,559 | 0,787 | 0,951 | 4,319 |
| Giữ hàng giỏ 3 món, gọi lần lượt | 5.000 | 0,581 | 0,810 | 0,983 | 2,931 |
| Trả hàng | 5.000 | 0,584 | 0,814 | 0,994 | 6,017 |
| `sync_item` | 5.000 | 0,269 | 0,421 | 0,516 | 1,765 |
| Giữ hàng khi 100 yêu cầu tranh nhau (20 kết nối) | 2.000 | 4,098 | 6,685 | 11,152 | 12,735 |

H4 mức Redis (N = 100, S0 = 5, 20 lượt): Lua 20/20 lượt đúng 5, bán lố 0, tồn thấp nhất 0. GET rồi DECRBY: 0/20 lượt đúng, bán 72–100 mỗi lượt, tổng bán lố 1.811, tồn thấp nhất −95.

### Qua HTTP (`hot-stock-h4.spec.ts`)

| Phép đo | n | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| API-14, gọi lần lượt | 100 | 13,3 | 16,5 | 18,4 | |
| API-14, 100 request cùng lúc | 2.000 | 714,0 | 776,6 | 889,6 | 904,5 |

H4 qua HTTP: 20/20 lượt đúng 5 giỏ `200`, 95 giỏ `409 OUT_OF_STOCK`, 0 lỗi khác, tồn thấp nhất 0. Vòng đầy đủ: 5 giỏ thắng, 3 trả tiền, 2 thanh toán lỗi, 2 giỏ khác giữ lại được, ra 5 đơn, Postgres `reserved = 5`, Redis `avail = 0`.

### Cập nhật tồn thời gian thực (`apps/realtime-gateway`, `npm run bench`)

Đường đi: Lua `reserve_hold` (chuỗi Lua đọc thẳng từ `lua/reserve-hold.ts`) → Redis Pub/Sub → gateway chạy **tiến trình riêng** (`src/index.ts`) → Socket.io → 100 client cùng xem một món, cùng máy. Đo từ lúc gửi lệnh Lua tới lúc client nhận `stock:update`. 20 vòng khởi động không tính, 200 vòng đo, chạy 3 lần.

| Lần | Client đầu tiên p50 / p95 (ms) | Client cuối cùng (đủ 100) p50 / p95 / p99 / max (ms) |
| :--- | :--- | :--- |
| 1 | 0,630 / 0,880 | 1,678 / 2,076 / 2,215 / 2,547 |
| 2 | 0,607 / 0,839 | 1,635 / 2,038 / 2,451 / 2,508 |
| 3 | 0,618 / 0,822 | 1,665 / 2,048 / 2,296 / 2,517 |

Không gồm độ trễ mạng internet và thời gian trình duyệt vẽ lại badge.

### Kiểm thử tính đúng

Tất cả đều pass: 34/34 test HTTP (`hot-stock-h4`, `hot-stock-ipn`, `hot-stock-lifecycle`, `hot-stock-reserve`, `hot-stock`), 31/31 test Lua mức module (`src/modules/hot-stock/__tests__/hold.spec.ts`), 5/5 test gateway.

## Cách chạy lại

```bash
cd apps/backend
# H4 qua HTTP (cần Postgres và Redis); in các dòng bắt đầu bằng "H4"
npx cross-env TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules jest --silent=false --runInBand --forceExit -- integration-tests/http/hot-stock-h4.spec.ts
# Mức Redis và so sánh GET + DECRBY; dùng key "c4f-bench:", không đụng dữ liệu cửa hàng.
# MEDUSA_WORKER_MODE=server để `medusa exec` không nạp job (job trả hold sẽ chạy trên dữ liệu thật).
MEDUSA_WORKER_MODE=server npx medusa exec ./src/scripts/bench-hot-stock.ts

cd ../realtime-gateway
# Cập nhật tồn thời gian thực; dùng key "c4f-bench-rt:<pid>:" và xoá khi xong. Tuỳ chọn: CLIENTS, WARMUP, ROUNDS, BENCH_PORT
npm run bench
```
