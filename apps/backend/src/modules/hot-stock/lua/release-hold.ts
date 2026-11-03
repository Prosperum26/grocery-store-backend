// Chuyển từ release_hold.lua của issue #9: thêm bộ đếm stock:held, và key của từng món phải nằm
// trong KEYS (bản cũ lấy tên key từ field của hash rồi ghi, sai quy tắc khai báo key của Redis).
export const RELEASE_HOLD_LUA = `
-- Trả hàng của một hold (thanh toán lỗi, khách bỏ, hoặc hết hạn). Gọi lại không trả lần hai.
-- KEYS[1] = hold:{cart}   KEYS[2] = hold:expiry   KEYS[3..] = cặp (stock:avail, stock:held) của mọi món trong hold
-- ARGV[1] = cart id       ARGV[2] = trạng thái cuối: 'RELEASED' hoặc 'EXPIRED'
-- Trả về: 1 vừa trả hàng · 0 không làm gì (không có hold, hoặc đã RELEASED/EXPIRED)
--         -1 hold đã CONFIRMED, không được trả · -2 tham số sai · -4 hold có món không nằm trong KEYS
if ARGV[2] ~= 'RELEASED' and ARGV[2] ~= 'EXPIRED' then return -2 end
local status = redis.call('HGET', KEYS[1], '__status')
if not status then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
if status == 'CONFIRMED' then return -1 end
if status ~= 'HELD' then return 0 end

local index = {}
for j = 1, (#KEYS - 2) / 2 do index[KEYS[1 + 2 * j]] = j end
local fields = redis.call('HGETALL', KEYS[1])
-- Kiểm hết trước khi ghi, để -4 không để lại hold trả dở.
for i = 1, #fields, 2 do
  if string.sub(fields[i], 1, 2) ~= '__' and not index[fields[i]] then return -4 end
end
for i = 1, #fields, 2 do
  local field = fields[i]
  if string.sub(field, 1, 2) ~= '__' then
    local qty = tonumber(fields[i + 1])
    redis.call('INCRBY', field, qty)
    redis.call('DECRBY', KEYS[2 + 2 * index[field]], qty)
  end
end
redis.call('HSET', KEYS[1], '__status', ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[1])
-- Giữ hash thêm một ngày để tra cứu, rồi Redis tự xoá.
redis.call('EXPIRE', KEYS[1], 86400)
return 1
`
