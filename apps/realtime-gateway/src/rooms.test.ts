import assert from "node:assert/strict"
import { test } from "node:test"
import { MAX_ITEMS, parseStockMessage, parseSubscription, roomOf } from "./rooms.ts"

test("parseStockMessage: đọc tin nhắn của Lua, số âm thành 0, tin sai dạng thì null", () => {
  assert.deepEqual(parseStockMessage('{"location_id":"sloc_1","inventory_item_id":"iitem_1","available":3}'), {
    location_id: "sloc_1",
    inventory_item_id: "iitem_1",
    available: 3,
  })
  assert.equal(parseStockMessage('{"location_id":"sloc_1","inventory_item_id":"iitem_1","available":-2}')?.available, 0)
  for (const bad of ["không phải json", "{}", '{"location_id":"s","inventory_item_id":"x y","available":1}', '{"location_id":"s","inventory_item_id":"i","available":"3"}']) {
    assert.equal(parseStockMessage(bad), null, bad)
  }
})

test("parseSubscription: mảng id hợp lệ, bỏ trùng; sai dạng, rỗng, quá nhiều thì báo lỗi", () => {
  assert.deepEqual(parseSubscription({ inventory_item_ids: ["iitem_1", "iitem_2", "iitem_1"] }), ["iitem_1", "iitem_2"])
  for (const bad of [null, {}, { inventory_item_ids: [] }, { inventory_item_ids: "iitem_1" }, { inventory_item_ids: ["stock:*"] }, { inventory_item_ids: [1] }]) {
    assert.equal(typeof parseSubscription(bad), "string", JSON.stringify(bad))
  }
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `iitem_${i}`)
  assert.equal(typeof parseSubscription({ inventory_item_ids: many }), "string")
})

test("roomOf", () => {
  assert.equal(roomOf("iitem_1"), "stock:iitem_1")
})
