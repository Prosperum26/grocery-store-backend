// Mới ở HS-2: đặt lại số còn giữ được của một món từ số của Postgres (plan mục 2.2).
export const SYNC_ITEM_LUA = `
-- avail = (stocked - reserved trong Postgres) - phần đang giữ trong Redis.
-- Đọc held và ghi avail trong cùng một lần chạy, nên một lần giữ hàng chen vào không làm lệch số.
-- avail có thể âm nếu admin giảm tồn xuống dưới phần đang giữ: khi đó không ai giữ thêm được
-- cho tới khi tồn tăng lại hoặc hold được trả.
-- KEYS[1] = stock:avail   KEYS[2] = stock:held   ARGV[1] = stocked - reserved (Postgres)   ARGV[2] = kênh Pub/Sub ('' = không phát)
-- Trả về: {avail mới, 1 nếu trước đó đã có key avail (0 nếu chưa), avail cũ (0 nếu chưa có)}
-- Phát số mới lên kênh Pub/Sub (HS-8). Tên kênh là ARGV vì kênh không phải key. Rỗng thì không phát.
local function publish(channel, availKey, available)
  if channel == '' then return end
  local loc, item = string.match(availKey, 'stock:avail:([^:]+):([^:]+)$')
  redis.call('PUBLISH', channel, cjson.encode({ location_id = loc, inventory_item_id = item, available = available }))
end
local pg = tonumber(ARGV[1])
if not pg or pg ~= math.floor(pg) then return redis.error_reply('hot-stock: bad postgres quantity') end
local old = redis.call('GET', KEYS[1])
local held = tonumber(redis.call('GET', KEYS[2]) or '0')
local avail = pg - held
redis.call('SET', KEYS[1], avail)
if held == 0 then redis.call('SET', KEYS[2], 0) end
-- Chỉ phát khi số đổi (đối soát 2.129 món mỗi 15 phút không làm ngập kênh).
if not old or tonumber(old) ~= avail then publish(ARGV[2], KEYS[1], avail) end
if old then return {avail, 1, tonumber(old)} end
return {avail, 0, 0}
`
