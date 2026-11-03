import type { SearchTypes } from "@medusajs/framework/types";

/** Tồn của một biến thể, như `loadAvailability` đọc ra. */
export type VariantAvailability = {
  manage_inventory?: boolean | null;
  available?: number | null;
};

/**
 * Sản phẩm còn hàng khi có ít nhất một biến thể không quản kho
 * (`manage_inventory === false`) hoặc còn tồn khả dụng (`available > 0`).
 * Không có biến thể nào thì không còn hàng.
 */
export function inStock(variants: VariantAvailability[]): boolean {
  return variants.some(
    (variant) =>
      variant.manage_inventory === false || (variant.available ?? 0) > 0,
  );
}

// Một biến thể có thể gồm nhiều inventory item (`required_quantity` mỗi item);
// tồn khả dụng đọc từ các level tại kho nối với sales channel của sản phẩm.
const STOCK_GRAPH_FIELDS = [
  "id",
  "sales_channels.stock_locations.id",
  "variants.manage_inventory",
  "variants.inventory_items.required_quantity",
  "variants.inventory_items.inventory.location_levels.location_id",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
];

type StockRow = {
  id: string;
  sales_channels?:
    | ({ stock_locations?: ({ id: string } | null)[] | null } | null)[]
    | null;
  variants?:
    | {
        manage_inventory?: boolean | null;
        inventory_items?:
          | {
              required_quantity?: number | null;
              inventory?: {
                location_levels?:
                  | {
                      location_id: string;
                      stocked_quantity?: number | null;
                      reserved_quantity?: number | null;
                    }[]
                  | null;
              } | null;
            }[]
          | null;
      }[]
    | null;
};

/**
 * Tồn khả dụng của từng biến thể, theo sản phẩm: tổng
 * `stocked_quantity − reserved_quantity` tại các kho nối sales channel của
 * sản phẩm. Biến thể nhiều item lấy item cạn nhất (chia cho `required_quantity`).
 * Biến thể quản kho mà không có item nào thì tồn 0.
 */
export async function loadAvailability(
  ids: string[],
  { container }: SearchTypes.SearchIngestionContext,
): Promise<Map<string, VariantAvailability[]>> {
  const availability = new Map<string, VariantAvailability[]>();

  if (!ids.length) {
    return availability;
  }

  const { data } = await container.query.graph({
    entity: "product",
    fields: STOCK_GRAPH_FIELDS,
    filters: { id: ids },
  });

  for (const product of data as StockRow[]) {
    const locationIds = new Set(
      (product.sales_channels ?? []).flatMap((channel) =>
        (channel?.stock_locations ?? []).map((location) => location?.id),
      ),
    );

    availability.set(
      product.id,
      (product.variants ?? []).map((variant) => {
        const perItem = (variant.inventory_items ?? []).map((item) => {
          const levels = item.inventory?.location_levels ?? [];
          const total = levels
            .filter((level) => locationIds.has(level.location_id))
            .reduce(
              (sum, level) =>
                sum +
                (level.stocked_quantity ?? 0) -
                (level.reserved_quantity ?? 0),
              0,
            );
          return Math.floor(total / (item.required_quantity || 1));
        });

        return {
          manage_inventory: variant.manage_inventory,
          available: perItem.length ? Math.max(0, Math.min(...perItem)) : 0,
        };
      }),
    );
  }

  return availability;
}
