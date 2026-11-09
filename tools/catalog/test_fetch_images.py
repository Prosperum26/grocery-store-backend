import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from fetch_images import convert_to_webp, fetch_one, make_session, pending


def make_image(size, mode="RGB", fmt="PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, (200, 30, 30, 128) if mode == "RGBA" else (200, 30, 30)).save(buffer, fmt)
    return buffer.getvalue()


def open_webp(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    assert image.format == "WEBP"
    return image


class FakeResponse:
    def __init__(self, content: bytes, content_type: str, status_code: int = 200):
        self.content = content
        self.headers = {"Content-Type": content_type}
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, response: FakeResponse):
        self.response = response

    def get(self, url, timeout):
        return self.response


class ConvertToWebpTest(unittest.TestCase):
    def test_convert_shrinks_long_side_to_800(self):
        image = open_webp(convert_to_webp(make_image((1600, 1000))))
        self.assertEqual(image.size, (800, 500))

    def test_convert_keeps_small_image_size(self):
        image = open_webp(convert_to_webp(make_image((300, 200))))
        self.assertEqual(image.size, (300, 200))

    def test_convert_handles_rgba_png(self):
        image = open_webp(convert_to_webp(make_image((100, 100), mode="RGBA")))
        self.assertEqual(image.size, (100, 100))

    def test_convert_rejects_non_image(self):
        with self.assertRaises(ValueError):
            convert_to_webp(b"<html>Not found</html>")


class PendingTest(unittest.TestCase):
    def test_pending_skips_existing_files(self):
        manifest = [
            {"catalog_id": "CAT-1", "image_url": "https://x/1.jpg"},
            {"catalog_id": "CAT-2", "image_url": "https://x/2.jpg"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "CAT-1.webp").write_bytes(b"x")
            self.assertEqual([r["catalog_id"] for r in pending(manifest, Path(tmp))], ["CAT-2"])

    def test_pending_ignores_partial_download_files(self):
        manifest = [{"catalog_id": "CAT-1", "image_url": "https://x/1.jpg"}]
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "CAT-1.webp.part").write_bytes(b"half")
            self.assertEqual(len(pending(manifest, Path(tmp))), 1)


class MakeSessionTest(unittest.TestCase):
    def test_session_identifies_the_project_instead_of_python_requests(self):
        # CDN trả 403 cho User-Agent mặc định "python-requests" nhưng nhận một tên dự án rõ ràng.
        user_agent = make_session().headers["User-Agent"]
        self.assertIn("Com4Fud", user_agent)
        self.assertNotIn("python-requests", user_agent)


class FetchOneTest(unittest.TestCase):
    row = {"catalog_id": "CAT-1", "image_url": "https://x/1.jpg"}

    def test_fetch_one_writes_webp_named_by_catalog_id(self):
        session = FakeSession(FakeResponse(make_image((1000, 1000)), "image/jpeg"))
        with tempfile.TemporaryDirectory() as tmp:
            fetch_one(session, self.row, Path(tmp))
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["CAT-1.webp"])
            self.assertEqual(open_webp((Path(tmp) / "CAT-1.webp").read_bytes()).size, (800, 800))

    def test_fetch_one_rejects_html_response_and_writes_nothing(self):
        session = FakeSession(FakeResponse(b"<html>Access denied</html>", "text/html"))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch_one(session, self.row, Path(tmp))
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_fetch_one_failure_leaves_no_partial_webp(self):
        session = FakeSession(FakeResponse(b"corrupted bytes", "image/jpeg"))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch_one(session, self.row, Path(tmp))
            self.assertEqual(list(Path(tmp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
