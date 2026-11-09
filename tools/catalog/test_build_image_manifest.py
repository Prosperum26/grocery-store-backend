import unittest

from build_image_manifest import rows_to_manifest


class RowsToManifestTest(unittest.TestCase):
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
