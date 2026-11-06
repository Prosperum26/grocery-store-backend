// Chuyển từ confirm_hold.lua của issue #9: thêm bộ đếm stock:held.
export const CONFIRM_HOLD_LUA = `
-- Xác nhận hold khi giỏ đã thành đơn. KHÔNG cộng trả stock:avail: từ lúc này Medusa giữ phần đó bằng
-- reservation (reserved_quantity), nên chỉ giảm stock:held. Bất biến avail + held = stocked - reserved vẫn đúng.
-- KEYS[1] = hold:{cart}   KEYS[2] = hold:expiry   KEYS[3..] = cặp (stock:avail, stock:held) của mọi món trong hold
-- ARGV[1] = cart id
-- Trả về: 1 vừa xác nhận · 2 đã CONFIRMED từ trước · 0 hold không ở HELD (không có, đã trả, đã hết hạn)
--         -4 hold có món không nằm trong KEYS
local status = redis.call('HGET', KEYS[1], '__status')
if status == 'CONFIRMED' then return 2 end
if status ~= 'HELD' then return 0 end

local index = {}
for j = 1, (#KEYS - 2) / 2 do index[KEYS[1 + 2 * j]] = j end
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  if string.sub(fields[i], 1, 2) ~= '__' and not index[fields[i]] then return -4 end
end
for i = 1, #fields, 2 do
  local field = fields[i]
  if string.sub(field, 1, 2) ~= '__' then
    redis.call('DECRBY', KEYS[2 + 2 * index[field]], tonumber(fields[i + 1]))
  end
end
redis.call('HSET', KEYS[1], '__status', 'CONFIRMED')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[1], 86400)
return 1
`
