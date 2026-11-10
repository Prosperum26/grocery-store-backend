import unittest

from build_image_manifest import normalize_image_url, rows_to_manifest


class NormalizeImageUrlTest(unittest.TestCase):
    def test_unwraps_bhx_image_proxy_to_original_cdn_url(self):
        url = (
            "https://img.bhxwork.vn/imgt/bhx/f_webp,fit_outside,quality_95,s_1560x1168/"
            "https://cdn.tgdd.vn/Products/Images/7618/234747/bhx/cha-que.jpg"
        )
        self.assertEqual(normalize_image_url(url), "https://cdn.tgdd.vn/Products/Images/7618/234747/bhx/cha-que.jpg")

    def test_drops_bing_thumbnail_size_params_to_get_larger_image(self):
        url = "https://th.bing.com/th/id/OIP.D-gWD0T3j_mhNnQUAShPwgHaHa?w=187&h=187&c=7&r=0&o=7&pid=1.7"
        self.assertEqual(normalize_image_url(url), "https://th.bing.com/th/id/OIP.D-gWD0T3j_mhNnQUAShPwgHaHa")

    def test_keeps_other_urls_and_trims_spaces(self):
        url = "https://bizweb.dktcdn.net/thumb/1024x1024/100/505/009/products/a.png?v=1"
        self.assertEqual(normalize_image_url(f"  {url} "), url)


class RowsToManifestTest(unittest.TestCase):
    def test_keeps_inline_data_image_and_normalizes_urls(self):
        rows = [
            {"catalog_id": "CAT-1", "image_url": "data:image/webp;base64,UklGRg==", "product_url": None},
            {"catalog_id": "CAT-2", "image_url": "https://th.bing.com/th/id/OIP.abc?w=1", "product_url": None},
            {"catalog_id": "CAT-3", "image_url": "data:text/html;base64,PGI+", "product_url": None},
        ]
        self.assertEqual(
            [(r["catalog_id"], r["image_url"]) for r in rows_to_manifest(rows)],
            [("CAT-1", "data:image/webp;base64,UklGRg=="), ("CAT-2", "https://th.bing.com/th/id/OIP.abc")],
        )

    def test_keeps_only_rows_with_http_image_url(self):
        rows = [
            {"catalog_id": "CAT-1", "image_url": "https://cdn.example/a.jpg", "product_url": "https://shop/a"},
            {"catalog_id": "CAT-2", "image_url": None, "product_url": "https://shop/b"},
            {"catalog_id": "CAT-3", "image_url": "", "product_url": None},
            {"catalog_id": "CAT-4", "image_url": "not-a-url", "product_url": None},
        ]
        self.assertEqual([r["catalog_id"] for r in rows_to_manifest(rows)], ["CAT-1"])

    def test_keeps_order_and_empty_product_url_becomes_none(self):
        rows = [
            {"catalog_id": "CAT-9", "image_url": "https://cdn.example/9.jpg", "product_url": ""},
            {"catalog_id": "CAT-2", "image_url": "https://cdn.example/2.png", "product_url": "https://shop/2"},
        ]
        self.assertEqual(
            rows_to_manifest(rows),
            [
                {"catalog_id": "CAT-9", "image_url": "https://cdn.example/9.jpg", "product_url": None},
                {"catalog_id": "CAT-2", "image_url": "https://cdn.example/2.png", "product_url": "https://shop/2"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
