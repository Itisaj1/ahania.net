#!/usr/bin/env python3

import html
import json
import re
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

from markdown_it import MarkdownIt
from mdit_py_plugins.container import container_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog"
PORTFOLIO_DIR = ROOT / "portfolio"
GALLERY_DIR = ROOT / "portfolio images"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"}

SITE = "https://ahania.net"
OG_IMAGE = f"{SITE}/og-image.jpg"

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title_text} - Austin Hania</title>
    <meta name="description" content="{description}">
    <meta property="og:site_name" content="Austin Hania">
    <meta property="og:type" content="article">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{description}">
    <meta property="og:url" content="{url}">
    <meta property="og:image" content="{image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{description}">
    <meta name="twitter:image" content="{image}">
    <link rel="stylesheet" href="/post.css">
    <link rel="stylesheet" href="/transitions.css">
</head>
<body>
    <article class="post">
        <h1>{title_text}</h1>
{location_line}{body}
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


def file_clock(path: Path) -> datetime:
    """mtime on the Pacific clock the rest of the site was generated with."""
    return datetime.fromtimestamp(path.stat().st_mtime, ZoneInfo("America/Los_Angeles")).replace(tzinfo=None)


def last_updated(path: Path) -> datetime:
    """Commit date of the last change to a file, on the clock recorded in the commit."""
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
            return datetime.fromisoformat(stamp).replace(tzinfo=None)
    except (OSError, ValueError):
        pass

    return file_clock(path)


def plain_description(body: str, fallback: str, limit: int = 160) -> str:
    """First readable sentence-ish chunk from markdown, for OG/meta description."""
    text = re.sub(r"^---\n.*?\n---\n", "", body, count=1, flags=re.S)
    text = re.sub(r"[#>*_`\[\]()]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return fallback
    if len(text) <= limit:
        return text
    clipped = text[: limit - 1].rsplit(" ", 1)[0]
    return f"{clipped}…"


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
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            meta[key.strip()] = value

    return meta, text[end + 4 :].lstrip("\n")


def _render_panel(kind: str):
    def render(renderer, tokens, idx, options, env) -> str:
        if tokens[idx].nesting == 1:
            return (
                f'<div class="panel panel--{kind}">'
                f'<p class="panel-label">{kind}</p>\n'
            )
        return "</div>\n"

    return render


def _render_expand(renderer, tokens, idx, options, env) -> str:
    if tokens[idx].nesting != 1:
        return "</details>\n"

    parts = tokens[idx].info.strip().split(None, 1)
    title = parts[1] if len(parts) > 1 else "details"
    return f'<details class="expand"><summary>{html.escape(title)}</summary>\n'


MARKDOWN = (
    MarkdownIt("commonmark", {"html": True, "linkify": False})
    .enable(["table", "strikethrough"])
    .use(tasklists_plugin, enabled=False)
)
for _kind in ("info", "note", "success", "warning", "error"):
    MARKDOWN.use(container_plugin, _kind, render=_render_panel(_kind))
MARKDOWN.use(container_plugin, "expand", render=_render_expand)


def render_markdown(text: str) -> str:
    return MARKDOWN.render(text).strip("\n")


def indent(text: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(pad + line if line else line for line in text.split("\n"))


def indent_page_body(text: str, spaces: int = 8) -> str:
    """Indent generated HTML, then drop that padding inside <pre>.

    indent() is for the page source. <pre> would otherwise display it.
    """
    padded = indent(text, spaces)
    pad = " " * spaces

    def restore(match: re.Match) -> str:
        return "<pre>" + match.group(1).replace("\n" + pad, "\n") + "</pre>"

    return re.sub(r"<pre>(.*?)</pre>", restore, padded, flags=re.DOTALL)


def blog_location(source: Path, meta: dict) -> dict | None:
    """Coords for a blog post. A name alone is not a location. A half pair fails the build."""
    has_lat = "lat" in meta
    has_lng = "lng" in meta
    if not has_lat and not has_lng:
        return None
    if not has_lat or not has_lng:
        raise SystemExit(f"{source.name}: location needs both lat and lng")
    try:
        lat = float(meta["lat"])
        lng = float(meta["lng"])
    except (TypeError, ValueError):
        raise SystemExit(f"{source.name}: location lat and lng must be numbers") from None
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        raise SystemExit(f"{source.name}: location lat/lng is out of range")
    name = meta.get("location", "").strip()
    return {"name": name or None, "lat": lat, "lng": lng}


def build_markdown_pages(directory: Path, output_path: Path, label: str) -> None:
    """Render every .md in a folder to a sibling .html page, then index the sources."""
    items = []
    section = directory.name

    # Top-level *.md only, on purpose: blog/_drafts/ and blog/images/ are never rendered.
    for source in sorted(directory.glob("*.md")):
        meta, body = split_front_matter(source.read_text(encoding="utf-8"))
        title = meta.get("title") or source.stem.replace("_", " ").replace("-", " ")
        if meta.get("date"):
            updated = datetime.strptime(meta["date"], "%Y-%m-%d")
        else:
            updated = last_updated(source)
        target = source.with_suffix(".html")
        page_url = f"{SITE}/{section}/{target.name}"
        description = meta.get("description") or plain_description(
            body, f"{title} — Austin Hania"
        )
        location_line = ""
        location = blog_location(source, meta) if directory == BLOG_DIR else None
        if directory == BLOG_DIR:
            place = meta.get("location", "").strip()
            if place:
                location_line = (
                    f'        <p class="post-location">written from {html.escape(place)}</p>\n'
                )

        page = PAGE_TEMPLATE.format(
            title=html.escape(title, quote=True),
            description=html.escape(description, quote=True),
            url=html.escape(page_url, quote=True),
            image=html.escape(OG_IMAGE, quote=True),
            body=indent_page_body(render_markdown(body)),
            location_line=location_line,
            updated=f"{MONTH_NAMES[updated.month - 1]} {updated.day}, {updated.year}",
            title_text=html.escape(title, quote=False),
        )

        target.write_text(page, encoding="utf-8")

        item = {
            "filename": source.name,
            "url": target.name,
            "title": title,
            "date": format_file_date(updated),
            "size": format_size(source.stat().st_size),
        }
        if location is not None:
            item["location"] = location
        items.append(item)

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
                "date": format_file_date(file_clock(file_path)),
                "size": format_size(stat.st_size),
            }
        )

    media.sort(key=lambda item: item["filename"].lower())
    output_path = directory / "manifest.json"
    output_path.write_text(f"{json.dumps(media, indent=2)}\n", encoding="utf-8")
    print(f"Generated {len(media)} {label} in {output_path.relative_to(ROOT)}")


build_markdown_pages(BLOG_DIR, BLOG_DIR / "posts.json", "blog posts")
build_markdown_pages(PORTFOLIO_DIR, PORTFOLIO_DIR / "items.json", "portfolio items")
collect_media(GALLERY_DIR, "gallery media")

color_index = subprocess.run(
    [sys.executable, str(Path(__file__).resolve().parent / "build-color-index.py")],
    check=False,
)
if color_index.returncode != 0:
    raise SystemExit(color_index.returncode)
