#!/usr/bin/env python3
"""Build portfolio images/color-index.json from gallery photos.

Downsamples each image, extracts a 5-color OKLab palette, and writes the
shared color-index contract used by the color wheel. Committed JSON is a
cache: unchanged file hashes are reused; new/changed images are processed;
deleted images are dropped.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GALLERY_DIR = ROOT / "portfolio images"
OUTPUT_PATH = GALLERY_DIR / "color-index.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
LONG_EDGE = 64
PALETTE_SIZE = 5
KMEANS_ITERS = 12


# --- OKLab / OKLCH (Björn Ottosson) -----------------------------------------

def srgb_to_linear(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def rgb_to_oklab(r: int, g: int, b: int) -> tuple[float, float, float]:
    lr, lg, lb = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = math.sqrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    m = math.sqrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    s = math.sqrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b_ = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, a, b_


def oklab_to_rgb(L: float, a: float, b_: float) -> tuple[int, int, int]:
    l_ = L + 0.3963377774 * a + 0.2158037573 * b_
    m_ = L - 0.1055613458 * a - 0.0638541728 * b_
    s_ = L - 0.0894841775 * a - 1.2914855480 * b_
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return (
        round(linear_to_srgb(r) * 255),
        round(linear_to_srgb(g) * 255),
        round(linear_to_srgb(b) * 255),
    )


def oklab_to_oklch(L: float, a: float, b_: float) -> tuple[float, float, float]:
    C = math.sqrt(a * a + b_ * b_)
    h = (math.degrees(math.atan2(b_, a)) + 360.0) % 360.0
    return L, C, h


def to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


# --- sampling & clustering --------------------------------------------------

def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def downsample_pixels(path: Path) -> list[tuple[float, float, float]]:
    try:
        with Image.open(path) as image:
            image = image.convert("RGBA")
            width, height = image.size
            if width <= 0 or height <= 0:
                raise ValueError("empty image")
            scale = LONG_EDGE / max(width, height)
            new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
            image = image.resize(new_size, Image.Resampling.BOX)
            pixels = []
            for r, g, b, a in image.get_flattened_data():
                if a < 8:
                    continue
                pixels.append(rgb_to_oklab(r, g, b))
    except Exception as error:  # noqa: BLE001 — surface any decode failure
        raise RuntimeError(f"unreadable image: {path.name}: {error}") from error

    if not pixels:
        raise RuntimeError(f"unreadable image: {path.name}: no opaque pixels")
    return pixels


def init_centroids(pixels: list[tuple[float, float, float]], k: int) -> list[list[float]]:
    """Deterministic init: pick k evenly spaced samples from sorted pixels."""
    ordered = sorted(pixels)
    n = len(ordered)
    if n <= k:
        cents = [list(p) for p in ordered]
        while len(cents) < k:
            cents.append(list(ordered[-1]))
        return cents
    return [list(ordered[(i * (n - 1)) // (k - 1)]) for i in range(k)]


def kmeans_oklab(pixels: list[tuple[float, float, float]], k: int) -> list[tuple[list[float], int]]:
    centroids = init_centroids(pixels, k)
    assignments = [0] * len(pixels)

    for _ in range(KMEANS_ITERS):
        counts = [0] * k
        sums = [[0.0, 0.0, 0.0] for _ in range(k)]
        for index, pixel in enumerate(pixels):
            best = 0
            best_dist = float("inf")
            for c_index, centroid in enumerate(centroids):
                dL = pixel[0] - centroid[0]
                da = pixel[1] - centroid[1]
                db = pixel[2] - centroid[2]
                dist = dL * dL + da * da + db * db
                if dist < best_dist:
                    best_dist = dist
                    best = c_index
            assignments[index] = best
            counts[best] += 1
            sums[best][0] += pixel[0]
            sums[best][1] += pixel[1]
            sums[best][2] += pixel[2]

        moved = False
        for c_index in range(k):
            if counts[c_index] == 0:
                continue
            new = [sums[c_index][i] / counts[c_index] for i in range(3)]
            if any(abs(new[i] - centroids[c_index][i]) > 1e-9 for i in range(3)):
                moved = True
            centroids[c_index] = new
        if not moved:
            break

    clusters = []
    for c_index, centroid in enumerate(centroids):
        if counts[c_index] == 0:
            continue
        clusters.append((centroid, counts[c_index]))

    # Stable order: weight desc, then L, a, b.
    clusters.sort(key=lambda item: (-item[1], item[0][0], item[0][1], item[0][2]))
    return clusters


def palette_from_pixels(pixels: list[tuple[float, float, float]]) -> tuple[dict, list[dict]]:
    clusters = kmeans_oklab(pixels, PALETTE_SIZE)
    total = sum(count for _, count in clusters) or 1
    palette = []
    for centroid, count in clusters:
        r, g, b = oklab_to_rgb(*centroid)
        L, C, h = oklab_to_oklch(*centroid)
        palette.append(
            {
                "hex": to_hex(r, g, b),
                "oklch": [round(L, 4), round(C, 4), round(h, 2)],
                "weight": round(count / total, 4),
            }
        )

    # Normalize weights so they sum to 1 after rounding.
    weight_sum = sum(entry["weight"] for entry in palette) or 1.0
    for entry in palette:
        entry["weight"] = round(entry["weight"] / weight_sum, 4)
    drift = round(1.0 - sum(entry["weight"] for entry in palette), 4)
    if palette:
        palette[0]["weight"] = round(palette[0]["weight"] + drift, 4)

    dominant = {"hex": palette[0]["hex"], "oklch": list(palette[0]["oklch"])}
    return dominant, palette


def index_image(path: Path, digest: str) -> dict:
    pixels = downsample_pixels(path)
    dominant, palette = palette_from_pixels(pixels)
    return {
        "id": path.name,
        "src": f"portfolio%20images/{path.name}",
        "hash": digest,
        "dominant": dominant,
        "palette": palette,
    }


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, list):
        return {}
    return {entry["id"]: entry for entry in data if isinstance(entry, dict) and "id" in entry and "hash" in entry}


def build_color_index() -> None:
    if not GALLERY_DIR.is_dir():
        raise SystemExit(f"gallery folder missing: {GALLERY_DIR}")

    cache = load_cache(OUTPUT_PATH)
    images = sorted(
        (
            path
            for path in GALLERY_DIR.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ),
        key=lambda path: path.name.lower(),
    )

    entries = []
    reused = 0
    processed = 0

    for path in images:
        digest = file_hash(path)
        cached = cache.get(path.name)
        if cached and cached.get("hash") == digest and "dominant" in cached and "palette" in cached:
            entries.append(cached)
            reused += 1
            continue
        entries.append(index_image(path, digest))
        processed += 1

    entries.sort(key=lambda entry: entry["id"].lower())
    OUTPUT_PATH.write_text(f"{json.dumps(entries, indent=2)}\n", encoding="utf-8")
    print(
        f"Generated color index: {len(entries)} images "
        f"({processed} processed, {reused} cached) -> {OUTPUT_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    try:
        build_color_index()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
