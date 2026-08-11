#!/usr/bin/env python3

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog"
PORTFOLIO_DIR = ROOT / "portfolio"
IMAGES_DIR = ROOT / "images"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"}


def format_file_date(mtime: float) -> str:
    date = datetime.fromtimestamp(mtime)
    month = MONTHS[date.month - 1]
    return f"{date.day:02d}-{month}-{date.year} {date.hour}:{date.minute:02d}"


def format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    return f"{size / 1024:.1f} KB"


def collect_html_files(directory: Path, output_path: Path, label: str) -> None:
    items = []

    for file_path in sorted(directory.glob("*.html")):
        if file_path.name == "index.html":
            continue

        stat = file_path.stat()
        items.append(
            {
                "filename": file_path.name,
                "date": format_file_date(stat.st_mtime),
                "size": format_size(stat.st_size),
            }
        )

    items.sort(key=lambda item: item["filename"])
    output_path.write_text(f"{json.dumps(items, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(items)} {label} in {output_path.relative_to(ROOT)}")


def collect_images() -> None:
    images = []

    if not IMAGES_DIR.exists():
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    for file_path in sorted(IMAGES_DIR.iterdir()):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        stat = file_path.stat()
        images.append(
            {
                "filename": file_path.name,
                "path": f"images/{file_path.name}",
                "date": format_file_date(stat.st_mtime),
                "size": format_size(stat.st_size),
            }
        )

    images.sort(key=lambda image: image["filename"].lower())
    output_path = IMAGES_DIR / "manifest.json"
    output_path.write_text(f"{json.dumps(images, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(images)} images in {output_path.relative_to(ROOT)}")


collect_html_files(BLOG_DIR, BLOG_DIR / "posts.json", "blog posts")
collect_html_files(PORTFOLIO_DIR, PORTFOLIO_DIR / "items.json", "portfolio items")
collect_images()
