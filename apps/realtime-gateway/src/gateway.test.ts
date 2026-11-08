import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Redis } from "ioredis"
import { io as connect, type Socket } from "socket.io-client"
import { startGateway } from "./gateway.ts"

// Test với Redis thật (container com4fud-redis) và client Socket.io thật. Kênh riêng cho test.
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const CHANNEL = `c4f-test:gateway:${process.pid}:channel:inventory_events`

let gateway: Awaited<ReturnType<typeof startGateway>>
const publisher = new Redis(REDIS_URL)
const clients: Socket[] = []

before(async () => {
  gateway = await startGateway({ redisUrl: REDIS_URL, channel: CHANNEL, port: 0, corsOrigins: ["http://localhost:8000"] })
})
after(async () => {
  clients.forEach((client) => client.close())
  await gateway.close()
  await publisher.quit()
})

async function client() {
  const socket = connect(`http://localhost:${gateway.port}`, { transports: ["websocket"] })
  clients.push(socket)
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()))
  return socket
}
const received = (socket: Socket) => {
  const updates: unknown[] = []
  socket.on("stock:update", (update) => updates.push(update))
  return updates
}
const publish = (inventory_item_id: string, available: number) =>
  publisher.publish(CHANNEL, JSON.stringify({ location_id: "sloc_1", inventory_item_id, available }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

test("khách chỉ nhận cập nhật của món mình subscribe; unsubscribe thì thôi nhận", async () => {
  const a = await client()
  const b = await client()
  const updatesA = received(a)
  const updatesB = received(b)
  assert.deepEqual(await a.emitWithAck("subscribe", { inventory_item_ids: ["iitem_1"] }), { ok: true, inventory_item_ids: ["iitem_1"] })
  await b.emitWithAck("subscribe", { inventory_item_ids: ["iitem_2"] })

  await publish("iitem_1", 3)
  await publish("iitem_2", 0)
  await settle()
  assert.deepEqual(updatesA, [{ location_id: "sloc_1", inventory_item_id: "iitem_1", available: 3 }])
  assert.deepEqual(updatesB, [{ location_id: "sloc_1", inventory_item_id: "iitem_2", available: 0 }])

  await a.emitWithAck("unsubscribe", { inventory_item_ids: ["iitem_1"] })
  await publish("iitem_1", 2)
  await settle()
  assert.equal(updatesA.length, 1)
})

test("subscribe sai dạng thì ack lỗi; tin nhắn hỏng trên kênh bị bỏ qua", async () => {
  const c = await client()
  const updates = received(c)
  assert.deepEqual(await c.emitWithAck("subscribe", { inventory_item_ids: [] }), { ok: false, error: "inventory_item_ids must be a non-empty array" })
  await c.emitWithAck("subscribe", { inventory_item_ids: ["iitem_3"] })
  await publisher.publish(CHANNEL, "không phải json")
  await publish("iitem_3", 7)
  await settle()
  assert.deepEqual(updates, [{ location_id: "sloc_1", inventory_item_id: "iitem_3", available: 7 }])
})
