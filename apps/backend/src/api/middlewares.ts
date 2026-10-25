import { allowFields, configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
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
