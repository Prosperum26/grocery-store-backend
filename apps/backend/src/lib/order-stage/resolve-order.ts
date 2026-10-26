import type { RemoteQueryFunction } from "@medusajs/framework/types"

export const resolveOrderId = {
  /**
   * Các event `shipment.created` và `delivery.created` mang id của fulfillment, không phải id đơn
   * (verified-apis V3/S3). Tra ngược: fulfillment -> order qua link của Medusa.
   */
  async fromFulfillment(query: Pick<RemoteQueryFunction, "graph">, fulfillmentId: string): Promise<string | undefined> {
    const { data } = await query.graph({
      entity: "fulfillment",
      fields: ["id", "order.id"],
      filters: { id: fulfillmentId },
    })
    return (data[0] as { order?: { id?: string } } | undefined)?.order?.id
  },
}
