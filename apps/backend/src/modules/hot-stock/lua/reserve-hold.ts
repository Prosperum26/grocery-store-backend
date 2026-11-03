// Lua nằm trong file .ts vì `medusa build` không chép file .lua (verified-apis HS-0).
// Chuyển từ reserve_hold.lua của issue #9, thêm: gọi lại khi giỏ đang HELD thì thay hold cũ (plan D5),
// bộ đếm stock:held, và mọi key đều khai báo trong KEYS.
export const RESERVE_HOLD_LUA = `
-- Giữ hàng cho cả giỏ: đủ mọi món thì giữ hết, thiếu một món thì không giữ gì.
-- KEYS[1] = hold:{cart}   (hash: key avail -> số lượng, cộng __status, __exp, __attempt)
-- KEYS[2] = hold:expiry   (sorted set: cart -> hạn, giây)
-- KEYS[3..] = từng cặp (stock:avail:..., stock:held:...) cho mọi món của giỏ mới VÀ của hold cũ
-- ARGV[1] = cart id   ARGV[2] = now (giây)   ARGV[3] = ttl (giây)
-- ARGV[4..] = số lượng muốn giữ của từng cặp (0 = món chỉ có trong hold cũ, nay đã bỏ khỏi giỏ)
-- Trả về:
--   {1, exp}  đã giữ, exp = hạn (giây)
--   {0, j}    cặp j (đếm từ 1) không đủ hàng, không đổi gì
--   {-1, j}   key tồn của cặp j chưa có (Redis chưa đồng bộ từ Postgres), không đổi gì
--   {-2, j}   tham số không hợp lệ
--   {-3, j}   cặp j trùng key với một cặp trước
--   {-4, 0}   hold cũ có món không nằm trong KEYS (hold vừa bị đổi): service đọc lại rồi gọi lại
--   {3, 0}    giỏ đã CONFIRMED (đã thành đơn), không giữ nữa
local n = (#KEYS - 2) / 2
if n < 1 or n ~= math.floor(n) or #ARGV ~= n + 3 then return {-2, 0} end
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if not now or not ttl or ttl <= 0 then return {-2, 0} end

local status = redis.call('HGET', KEYS[1], '__status')
if status == 'CONFIRMED' then return {3, 0} end

-- Vị trí của từng key avail, để bắt dòng trùng và kiểm hold cũ.
local index = {}
local wantAny = false
for j = 1, n do
  local avail = KEYS[1 + 2 * j]
  if index[avail] then return {-3, j} end
  index[avail] = j
  local want = tonumber(ARGV[3 + j])
  if not want or want < 0 or want ~= math.floor(want) then return {-2, j} end
  if want > 0 then wantAny = true end
end
if not wantAny then return {-2, 0} end

-- Hold cũ còn HELD: phần nó đang giữ coi như còn trong kho, vì sẽ được thay bằng hold mới.
-- Hold cũ RELEASED/EXPIRED đã trả hàng rồi nên không tính.
local old = {}
if status == 'HELD' then
  local fields = redis.call('HGETALL', KEYS[1])
  for i = 1, #fields, 2 do
    local field = fields[i]
    if string.sub(field, 1, 2) ~= '__' then
      if not index[field] then return {-4, 0} end
      old[field] = tonumber(fields[i + 1])
    end
  end
end

-- Pha 1: kiểm mọi cặp, chưa ghi gì.
for j = 1, n do
  local avail = KEYS[1 + 2 * j]
  local have = redis.call('GET', avail)
  if not have then return {-1, j} end
  if tonumber(ARGV[3 + j]) > tonumber(have) + (old[avail] or 0) then return {0, j} end
end

-- Pha 2: chỉ ghi phần chênh lệch so với hold cũ (gọi lại y hệt thì không trừ thêm).
local attempt = tonumber(redis.call('HGET', KEYS[1], '__attempt') or '0') + 1
redis.call('DEL', KEYS[1])
for j = 1, n do
  local avail, held = KEYS[1 + 2 * j], KEYS[2 + 2 * j]
  local want = tonumber(ARGV[3 + j])
  local delta = want - (old[avail] or 0)
  if delta ~= 0 then
    redis.call('DECRBY', avail, delta)
    redis.call('INCRBY', held, delta)
  end
  if want > 0 then redis.call('HSET', KEYS[1], avail, want) end
end
local exp = now + ttl
redis.call('HSET', KEYS[1], '__status', 'HELD', '__exp', exp, '__attempt', attempt)
redis.call('ZADD', KEYS[2], exp, ARGV[1])
return {1, exp}
`
