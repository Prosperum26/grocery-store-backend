import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

// Chỉ dùng khi DB chưa có store nào (hiếm: Medusa luôn tạo sẵn).
const SALES_CHANNEL_NAME = "Com4Fud Web"
const REGION_NAME = "Việt Nam"
const STOCK_LOCATION_NAME = "Kho Q.7"
const FULFILLMENT_SET_NAME = "Kho Q.7 giao hàng"
const SHIPPING_OPTION_NAME = "Giao tận nhà"
// D5: phí giao cố định 15.000đ. VND là số nguyên đồng, không chia 100.
const SHIPPING_FEE_VND = 15000

export type BootstrapResult = {
  regionId: string
  salesChannelId: string
  stockLocationId: string
  shippingOptionId: string
  publishableKey: string
}

/**
 * Dựng khung cửa hàng Com4Fud: kênh bán, region VND, kho Q.7, phí giao, publishable key.
 * Idempotent: mỗi thứ đều tìm theo tên (hoặc loại) trước khi tạo, chạy lại không nhân đôi
 * và không xoá gì.
 */
export async function bootstrapStore(container: MedusaContainer): Promise<BootstrapResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  // 1+2. Store và kênh bán. Medusa tự tạo "Medusa Store", "Default Sales Channel" và một
  //      publishable key đã nối kênh đó khi khởi động, nên dùng lại thay vì tạo trùng.
  const supportedCurrencies = [{ currency_code: "vnd", is_default: true }]
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  })
  let salesChannelId = stores[0]?.default_sales_channel_id as string | undefined
  if (!salesChannelId) {
    const { data: channels } = await query.graph({
      entity: "sales_channel",
      fields: ["id"],
      filters: { name: SALES_CHANNEL_NAME },
    })
    salesChannelId =
      channels[0]?.id ??
      (
        await createSalesChannelsWorkflow(container).run({
          input: { salesChannelsData: [{ name: SALES_CHANNEL_NAME, description: "Website Com4Fud" }] },
        })
      ).result[0].id
  }
  if (stores.length) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: stores[0].id },
        update: { supported_currencies: supportedCurrencies, default_sales_channel_id: salesChannelId },
      },
    })
  } else {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          { name: "Com4Fud", supported_currencies: supportedCurrencies, default_sales_channel_id: salesChannelId },
        ],
      },
    })
  }

  // 3. Region VND. payment_providers tạm là system_default, BE-5a đổi thành VNPAY.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { name: REGION_NAME },
  })
  const regionId =
    regions[0]?.id ??
    (
      await createRegionsWorkflow(container).run({
        input: {
          regions: [
            {
              name: REGION_NAME,
              currency_code: "vnd",
              countries: ["vn"],
              payment_providers: ["pp_system_default"],
            },
          ],
        },
      })
    ).result[0].id

  // 4. Kho Q.7. Chỉ nối provider khi vừa tạo kho (link.create không idempotent).
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { name: STOCK_LOCATION_NAME },
  })
  let stockLocationId = locations[0]?.id as string | undefined
  if (!stockLocationId) {
    const {
      result: [created],
    } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: { city: "Hồ Chí Minh", country_code: "VN", address_1: "Quận 7" },
          },
        ],
      },
    })
    stockLocationId = created.id
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
  }
  const linkedChannelIds = (locations[0]?.sales_channels ?? []).map((c: any) => c?.id)
  if (!linkedChannelIds.includes(salesChannelId)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocationId, add: [salesChannelId] },
    })
  }

  // 5. Fulfillment set + service zone (country vn) của kho
  let [fulfillmentSet] = await fulfillment.listFulfillmentSets(
    { name: FULFILLMENT_SET_NAME },
    { relations: ["service_zones"] }
  )
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillment.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: "shipping",
      service_zones: [{ name: "Việt Nam", geo_zones: [{ country_code: "vn", type: "country" }] }],
    })
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  }

  // 6. Shipping option "Giao tận nhà". Shipping profile mặc định do migration của core tạo,
  //    nhưng test runner có thể chưa có nên tạo bù.
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id"],
    filters: { name: SHIPPING_OPTION_NAME },
  })
  let shippingOptionId = options[0]?.id as string | undefined
  if (!shippingOptionId) {
    const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] })
    const shippingProfileId =
      profiles[0]?.id ??
      (
        await createShippingProfilesWorkflow(container).run({
          input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
        })
      ).result[0].id
    const {
      result: [option],
    } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: SHIPPING_OPTION_NAME,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfileId,
          type: { label: "Giao tận nhà", description: "Giao theo khung giờ đã chọn.", code: "home-delivery" },
          prices: [{ currency_code: "vnd", amount: SHIPPING_FEE_VND }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    shippingOptionId = option.id
  }

  // 7. Publishable key nối kênh bán
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "sales_channels.id"],
    filters: { type: "publishable" },
  })
  let key: { id: string; token: string; sales_channels?: any[] } = keys[0] as any
  if (!key) {
    key = (
      await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: "Com4Fud Storefront", type: "publishable", created_by: "" }] },
      })
    ).result[0] as any
  }
  const keyChannelIds = (key.sales_channels ?? []).map((c: any) => c?.id)
  if (!keyChannelIds.includes(salesChannelId)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [salesChannelId] },
    })
  }

  return {
    regionId,
    salesChannelId,
    stockLocationId,
    shippingOptionId,
    publishableKey: key.token,
  }
}
