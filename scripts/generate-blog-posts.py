#!/usr/bin/env python3

import json
import os
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def format_file_date(mtime: float) -> str:
    date = datetime.fromtimestamp(mtime)
    month = MONTHS[date.month - 1]
    return f"{date.day:02d}-{month}-{date.year} {date.hour}:{date.minute:02d}"


def format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    return f"{size / 1024:.1f} KB"


posts = []
for file_path in sorted(BLOG_DIR.glob("*.html")):
    if file_path.name == "index.html":
        continue

    stat = file_path.stat()
    posts.append(
        {
            "filename": file_path.name,
            "date": format_file_date(stat.st_mtime),
            "size": format_size(stat.st_size),
        }
    )

posts.sort(key=lambda post: post["filename"])

output_path = BLOG_DIR / "posts.json"
output_path.write_text(f"{json.dumps(posts, indent=2)}\n", encoding="utf-8")

print(f"Generated {len(posts)} blog posts in {output_path.relative_to(ROOT)}")
