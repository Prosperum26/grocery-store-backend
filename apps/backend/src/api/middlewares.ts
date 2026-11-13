import {
  allowFields,
  authenticate,
  configureStoreSearch,
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from '@medusajs/framework/http'
import { StartDeliveryBody } from './admin/orders/[id]/start-delivery/validators'
import { SetDeliverySlotBody } from './store/carts/[id]/delivery-slot/validators'
import { AiAskBody } from './store/ai/ask/validators'
import { AiRecipeBody } from './store/ai/recipe/validators'
import { AiSearchBody } from './store/ai/search/validators'
import { AiSuggestByProductsBody } from './store/ai/suggest/by-products/validators'
import { AiDiscoverBody } from './store/ai/suggest/discover/validators'
import { StockQuery } from './store/stock/validators'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    // Tồn đã trừ phần đang giữ (hot-stock HS-8, API-15): ?variant_ids=a,b, 1–100 id.
    {
      method: ['GET'],
      matcher: '/store/stock',
      middlewares: [validateAndTransformQuery(StockQuery, {})],
    },
    // Store API silently drops fields outside a route's `allowed` list.
    // No `method` key: allowFields must run for every method of the matcher.
    // `variants.metadata` already comes back via the default `*variants`; it is
    // listed so the storefront's `+variants.metadata` stays valid if that changes.
    {
      matcher: '/store/products*',
      middlewares: [
        allowFields(
          'variants.metadata',
          'categories.id',
          'categories.handle',
          'categories.name'
        ),
      ],
    },
    // Bắt đầu giao (BE-7): bắt buộc tên tài xế và biển số. /admin/* đã được core xác thực.
    {
      method: ['POST'],
      matcher: '/admin/orders/:id/start-delivery',
      middlewares: [validateAndTransformBody(StartDeliveryBody)],
    },
    {
      method: ['POST'],
      matcher: '/store/carts/:id/delivery-slot',
      middlewares: [validateAndTransformBody(SetDeliverySlotBody)],
    },
    // Ví mã giảm giá: cần khách đã đăng nhập (session hoặc bearer token), nếu không thì 401.
    {
      method: ['GET'],
      matcher: '/store/customers/me/vouchers',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    // Khách huỷ đơn của mình (BE-8): cần đăng nhập, nếu không thì 401. Route tự kiểm quyền sở hữu đơn.
    {
      method: ['POST'],
      matcher: '/store/orders/:id/cancel',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    // Giỏ "Mua lại" (BE-9): cần khách đăng nhập, nếu không thì 401.
    {
      matcher: '/store/predictive/*',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    // Trợ lý Bếp (API-8, hợp đồng AI-0): kiểm body ngay cả khi route còn là bản giữ chỗ. Không bắt đăng nhập:
    // khách vãng lai cũng tìm món được.
    {
      method: ['POST'],
      matcher: '/store/ai/search',
      middlewares: [validateAndTransformBody(AiSearchBody)],
    },
    {
      method: ['POST'],
      matcher: '/store/ai/copilot',
      middlewares: [validateAndTransformBody(AiSearchBody)],
    },
    {
      method: ['POST'],
      matcher: '/store/ai/recipe',
      middlewares: [validateAndTransformBody(AiRecipeBody)],
    },
    {
      method: ['POST'],
      matcher: '/store/ai/ask',
      middlewares: [validateAndTransformBody(AiAskBody)],
    },
    // Gợi ý món từ giỏ hàng hoặc một sản phẩm (B, C): khách vãng lai cũng dùng được.
    {
      method: ['POST'],
      matcher: '/store/ai/suggest/by-products',
      middlewares: [validateAndTransformBody(AiSuggestByProductsBody)],
    },
    // "Thử món mới?" (A): đăng nhập thì dùng lịch sử mua, chưa đăng nhập vẫn dùng được (không phải 401).
    {
      method: ['POST'],
      matcher: '/store/ai/suggest/discover',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
        validateAndTransformBody(AiDiscoverBody),
      ],
    },
    // Order retrieve omits `metadata` (the list route has it); needed for metadata.stage.
    // Risk: this route is unauthenticated, anyone holding the order UUID can read it.
    {
      matcher: '/store/orders/:id',
      middlewares: [allowFields('metadata')],
    },
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
  ],
})
