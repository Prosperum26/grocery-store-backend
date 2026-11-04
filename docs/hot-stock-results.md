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

## Cách chạy lại

```bash
cd apps/backend
# H4 qua HTTP (cần Postgres và Redis); in các dòng bắt đầu bằng "H4"
npx cross-env TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules jest --silent=false --runInBand --forceExit -- integration-tests/http/hot-stock-h4.spec.ts
# Mức Redis và so sánh GET + DECRBY; dùng key "c4f-bench:", không đụng dữ liệu cửa hàng
npx medusa exec ./src/scripts/bench-hot-stock.ts
```
