"""Tải ảnh sản phẩm trong image-manifest.json, nén thành WebP và lưu vào thư mục seed-data/images.

Chạy (Python 3.11+, cần requests và Pillow: pip install -r tools/catalog/requirements.txt):
    python tools/catalog/fetch_images.py [--limit N]

- Ảnh lưu thành <catalog_id>.webp, cạnh dài tối đa 800 px. Thư mục này bị gitignore, mỗi người tự chạy.
- Chạy lại chỉ tải những ảnh còn thiếu. Ảnh lỗi chỉ được liệt kê cuối lượt, không làm dừng cả lượt.
- Xem tools/catalog/IMAGES.md về nguồn ảnh và bản quyền.
"""

import argparse
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

MANIFEST = Path(__file__).resolve().parent / "image-manifest.json"
IMAGES_DIR = Path(__file__).resolve().parents[2] / "apps/backend/src/lib/seed/seed-data/images"
MAX_SIDE = 800
QUALITY = 80
TIMEOUT = 20  # giây cho mỗi request
ATTEMPTS = 3
WORKERS = 4  # số luồng tải song song, để không dồn request vào CDN
USER_AGENT = "Com4Fud-student-project/1.0 (MSIS4133 coursework)"


def make_session() -> requests.Session:
    """Session tự nhận dạng đúng dự án; CDN trả 403 cho User-Agent mặc định của python-requests."""
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def convert_to_webp(data: bytes, max_side: int = MAX_SIDE, quality: int = QUALITY) -> bytes:
    """Thu nhỏ để cạnh dài <= max_side (không phóng to) và đổi sang WebP. Không phải ảnh thì ném ValueError."""
    try:
        image = Image.open(io.BytesIO(data))
        # WebP lưu được RGB và RGBA; PNG bảng màu (P) hoặc có alpha đổi sang RGBA, còn lại RGB.
        image = image.convert("RGBA" if image.mode in ("P", "LA", "RGBA") else "RGB")
        image.thumbnail((max_side, max_side))
        out = io.BytesIO()
        image.save(out, "WEBP", quality=quality)
        return out.getvalue()
    except (OSError, ValueError) as error:  # UnidentifiedImageError và ảnh cụt đều là OSError
        raise ValueError(f"không phải ảnh hợp lệ: {error}") from error


def pending(manifest: list[dict], out_dir: Path) -> list[dict]:
    """Các dòng chưa có file <catalog_id>.webp (file .part của lần tải dở không tính)."""
    return [row for row in manifest if not (out_dir / f"{row['catalog_id']}.webp").exists()]


def _get(session, url: str):
    """GET có thử lại tối đa ATTEMPTS lần với lỗi mạng hoặc HTTP lỗi, chờ lâu dần giữa các lần."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            response = session.get(url, timeout=TIMEOUT)
            response.raise_for_status()
            return response
        except Exception:
            if attempt == ATTEMPTS:
                raise
            time.sleep(attempt)


def fetch_one(session, row: dict, out_dir: Path) -> None:
    """Tải một ảnh. Chỉ khi chuyển đổi thành công mới ghi file, nên không bao giờ để lại .webp dở dang."""
    response = _get(session, row["image_url"])
    content_type = response.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        raise ValueError(f"không phải ảnh (Content-Type: {content_type or 'trống'})")
    webp = convert_to_webp(response.content)
    target = out_dir / f"{row['catalog_id']}.webp"
    part = target.with_name(target.name + ".part")
    part.write_bytes(webp)
    part.replace(target)  # đổi tên là thao tác nguyên tử: file đích hoặc đủ, hoặc không có


def main() -> None:
    # Console Windows mặc định cp1252 không in được tiếng Việt.
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Tải ảnh sản phẩm theo image-manifest.json")
    parser.add_argument("--limit", type=int, help="chỉ tải N ảnh còn thiếu đầu tiên (để chạy thử)")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    todo = pending(manifest, IMAGES_DIR)
    already = len(manifest) - len(todo)
    if args.limit is not None:
        todo = todo[: args.limit]

    failures: list[tuple[str, str]] = []
    session = make_session()

    def work(row: dict) -> None:
        try:
            fetch_one(session, row, IMAGES_DIR)
        except Exception as error:
            failures.append((row["catalog_id"], str(error)))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(work, todo))

    print(f"Đã có sẵn: {already}, tải mới: {len(todo) - len(failures)}, lỗi: {len(failures)}")
    for catalog_id, reason in sorted(failures):
        print(f"  {catalog_id}: {reason}")


if __name__ == "__main__":
    main()
