#!/usr/bin/env python3

import html
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog"
PORTFOLIO_DIR = ROOT / "portfolio"
IMAGES_DIR = ROOT / "images"
GALLERY_DIR = ROOT / "portfolio images"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"}

POST_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Austin Hania</title>
    <link rel="stylesheet" href="/blog/post.css">
    <link rel="stylesheet" href="/transitions.css">
</head>
<body>
    <article class="post">
        <p class="post-back"><a href="/blog/">&larr; blog</a></p>
        <h1>{title}</h1>
{body}
        <p class="post-updated">updated on {updated}</p>
    </article>
</body>
</html>
"""


def format_file_date(date: datetime) -> str:
    month = MONTHS[date.month - 1]
    return f"{date.day:02d}-{month}-{date.year} {date.hour}:{date.minute:02d}"


def format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def last_updated(path: Path) -> datetime:
    """Commit date of the last change to a file, falling back to its mtime."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", str(path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        stamp = result.stdout.strip()
        if stamp:
            return datetime.fromisoformat(stamp).astimezone().replace(tzinfo=None)
    except (OSError, ValueError):
        pass

    return datetime.fromtimestamp(path.stat().st_mtime)


def split_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text

    end = text.find("\n---", 3)
    if end == -1:
        return {}, text

    meta = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()

    return meta, text[end + 4 :].lstrip("\n")


def render_inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", r'<img src="\2" alt="\1">', text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return text


def render_markdown(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    blocks = []
    index = 0

    def is_list_item(line: str) -> bool:
        return line.strip().startswith(("- ", "* "))

    while index < len(lines):
        line = lines[index].strip()

        if not line:
            index += 1
        elif line in ("---", "***", "___"):
            blocks.append("<hr>")
            index += 1
        elif line.startswith("#"):
            level = min(len(line) - len(line.lstrip("#")), 6)
            blocks.append(f"<h{level}>{render_inline(line[level:].strip())}</h{level}>")
            index += 1
        elif is_list_item(line):
            items = []
            while index < len(lines) and is_list_item(lines[index]):
                items.append(f"<li>{render_inline(lines[index].strip()[2:].strip())}</li>")
                index += 1
            blocks.append("<ul>\n" + "\n".join(items) + "\n</ul>")
        elif line.startswith(">"):
            quoted = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quoted.append(lines[index].strip().lstrip(">").strip())
                index += 1
            blocks.append(f"<blockquote>{render_inline(' '.join(quoted))}</blockquote>")
        else:
            paragraph = []
            while index < len(lines):
                current = lines[index].strip()
                if not current or current.startswith("#") or current.startswith(">") or is_list_item(current):
                    break
                paragraph.append(current)
                index += 1
            blocks.append(f"<p>{render_inline(' '.join(paragraph))}</p>")

    return "\n".join(blocks)


def indent(text: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(pad + line if line else line for line in text.split("\n"))


def build_blog_posts() -> None:
    """Render every blog/*.md into a matching .html page and index them."""
    items = []

    for source in sorted(BLOG_DIR.glob("*.md")):
        meta, body = split_front_matter(source.read_text(encoding="utf-8"))
        title = meta.get("title") or source.stem.replace("_", " ").replace("-", " ")
        updated = last_updated(source)

        page = POST_TEMPLATE.format(
            title=html.escape(title, quote=False),
            body=indent(render_markdown(body), 8),
            updated=f"{MONTH_NAMES[updated.month - 1]} {updated.day}, {updated.year}",
        )

        target = source.with_suffix(".html")
        target.write_text(page, encoding="utf-8")

        items.append(
            {
                "filename": target.name,
                "title": title,
                "date": format_file_date(updated),
                "size": format_size(target.stat().st_size),
            }
        )

    items.sort(key=lambda item: item["filename"])
    output_path = BLOG_DIR / "posts.json"
    output_path.write_text(f"{json.dumps(items, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(items)} blog posts in {output_path.relative_to(ROOT)}")


def collect_html_files(directory: Path, output_path: Path, label: str) -> None:
    items = []

    for file_path in sorted(directory.glob("*.html")):
        if file_path.name == "index.html":
            continue

        items.append(
            {
                "filename": file_path.name,
                "date": format_file_date(last_updated(file_path)),
                "size": format_size(file_path.stat().st_size),
            }
        )

    items.sort(key=lambda item: item["filename"])
    output_path.write_text(f"{json.dumps(items, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(items)} {label} in {output_path.relative_to(ROOT)}")


def collect_media(directory: Path, label: str) -> None:
    media = []

    if not directory.exists():
        print(f"Skipped {label}: {directory.name} folder not found")
        return

    for file_path in sorted(directory.iterdir()):
        if not file_path.is_file():
            continue

        suffix = file_path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            continue

        media_type = "image"

        stat = file_path.stat()
        media.append(
            {
                "filename": file_path.name,
                "type": media_type,
                "date": format_file_date(datetime.fromtimestamp(stat.st_mtime)),
                "size": format_size(stat.st_size),
            }
        )

    media.sort(key=lambda item: item["filename"].lower())
    output_path = directory / "manifest.json"
    output_path.write_text(f"{json.dumps(media, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(media)} {label} in {output_path.relative_to(ROOT)}")


build_blog_posts()
collect_html_files(PORTFOLIO_DIR, PORTFOLIO_DIR / "items.json", "portfolio items")
collect_media(IMAGES_DIR, "landing images")
collect_media(GALLERY_DIR, "gallery media")
