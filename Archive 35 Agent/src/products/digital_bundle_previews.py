"""Create truthful Etsy preview cards for a three-photograph bundle."""

from __future__ import annotations

import textwrap
from pathlib import Path

from PIL import Image, ImageDraw

from src.products.digital_preview_cards import (
    ACCENT,
    INK,
    PAPER,
    SIZE,
    _centered,
    _fit_photo,
    _font,
)


def _save(canvas: Image.Image, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "JPEG", quality=94, optimize=True)
    return destination


def _three_photos(sources: list[Path], box=(560, 1160)) -> list[Image.Image]:
    if len(sources) != 3:
        raise ValueError("Bundle previews require exactly three photographs")
    return [_fit_photo(source, box) for source in sources]


def build_bundle_cover(sources: list[Path], destination: Path) -> Path:
    canvas = Image.new("RGB", (SIZE, SIZE), INK)
    draw = ImageDraw.Draw(canvas)
    _centered(draw, 65, "THE RESTLESS EYE", _font(38, True), PAPER)
    _centered(draw, 135, "SET OF 3 DIGITAL DOWNLOADS", _font(78, True), ACCENT)
    for index, photo in enumerate(_three_photos(sources)):
        x = 100 + index * 610 + (560 - photo.width) // 2
        canvas.paste(photo, (x, 315 + (1160 - photo.height) // 2))
    _centered(draw, 1580, "15 HIGH-RESOLUTION JPG FILES", _font(54, True), PAPER)
    _centered(draw, 1680, "5 ZIP FOLDERS • 5 PRINT RATIOS", _font(45), PAPER)
    _centered(draw, 1790, "NO PHYSICAL ITEMS • FRAMES NOT INCLUDED", _font(40), ACCENT)
    _centered(draw, 1880, "ORIGINAL PHOTOGRAPHY • PERSONAL USE", _font(32), "#aaa79f")
    return _save(canvas, destination)


def build_artwork_overview(
    sources: list[Path],
    names: list[str],
    collection_title: str,
    destination: Path,
) -> Path:
    if len(names) != 3:
        raise ValueError("Bundle overview requires three artwork names")
    canvas = Image.new("RGB", (SIZE, SIZE), PAPER)
    draw = ImageDraw.Draw(canvas)
    heading = f"{collection_title.upper()} • THE COMPLETE SET"
    _centered(draw, 95, heading, _font(66, True), INK)
    photos = _three_photos(sources, box=(520, 980))
    for index, (photo, name) in enumerate(zip(photos, names)):
        x = 140 + index * 575 + (520 - photo.width) // 2
        y = 380 + (980 - photo.height) // 2
        canvas.paste(photo, (x, y))
        draw.rounded_rectangle((130 + index * 575, 1430, 670 + index * 575, 1605), 18, fill="#ffffff")
        lines = textwrap.wrap(name, width=27)[:2]
        for line_index, line in enumerate(lines):
            box = draw.textbbox((0, 0), line, font=_font(29, True))
            draw.text(
                (400 + index * 575 - box[2] / 2, 1470 + line_index * 48),
                line,
                font=_font(29, True),
                fill=INK,
            )
    _centered(draw, 1740, "THREE COORDINATED ORIGINAL PHOTOGRAPHS", _font(45, True), ACCENT)
    _centered(draw, 1830, "PRINT TOGETHER OR DISPLAY INDIVIDUALLY", _font(37), INK)
    return _save(canvas, destination)


def _text_card(
    heading: str,
    rows: list[tuple[str, str]],
    footer: str,
    destination: Path,
) -> Path:
    canvas = Image.new("RGB", (SIZE, SIZE), PAPER)
    draw = ImageDraw.Draw(canvas)
    _centered(draw, 105, heading, _font(72, True), INK)
    for index, (label, detail) in enumerate(rows):
        y = 385 + index * 250
        draw.rounded_rectangle((180, y, 1820, y + 185), 22, fill="#ffffff")
        draw.text((250, y + 38), label, font=_font(54, True), fill=ACCENT)
        draw.text((560, y + 58), detail, font=_font(39), fill=INK)
    _centered(draw, 1790, footer, _font(39, True), INK)
    _centered(draw, 1880, "NO PHYSICAL ITEMS • FRAMES NOT INCLUDED", _font(35), "#7a351f")
    return _save(canvas, destination)


def build_bundle_previews(
    sources: list[str | Path],
    names: list[str],
    output_dir: str | Path,
    *,
    collection_title: str = "Desert Geometry",
) -> list[Path]:
    source_paths = [Path(source).resolve() for source in sources]
    if any(not source.is_file() for source in source_paths):
        raise FileNotFoundError("One or more bundle preview sources are missing")
    output = Path(output_dir).resolve()
    outputs = [
        build_bundle_cover(source_paths, output / "00-set-of-3-cover.jpg"),
        build_artwork_overview(
            source_paths,
            names,
            collection_title,
            output / "01-complete-set.jpg",
        ),
    ]
    outputs.append(_text_card(
        "15 PRINTABLE FILES INCLUDED",
        [
            ("2:3", "3 JPGs • up to 24×36"),
            ("3:4", "3 JPGs • up to 18×24"),
            ("4:5", "3 JPGs • up to 16×20"),
            ("11:14", "3 JPGs • classic frames"),
            ("ISO", "3 JPGs • A5 through A1"),
        ],
        "FIVE ZIP FOLDERS • ONE FOR EACH RATIO",
        output / "02-files-and-ratios.jpg",
    ))
    outputs.append(_text_card(
        "DOWNLOAD • UNZIP • PRINT",
        [
            ("1", "Download 5 ZIPs from Etsy"),
            ("2", "Choose your frame ratio"),
            ("3", "Open the matching ZIP"),
            ("4", "Select any of the 3 photos"),
            ("5", "Print locally or online"),
        ],
        "SIMPLE FILE NAMES • 300 DPI METADATA",
        output / "03-how-it-works.jpg",
    ))
    outputs.append(_text_card(
        "AUTHENTIC PHOTOGRAPHY",
        [
            ("3", "Photographs by Wolfgang Schram"),
            ("0", "AI-generated artworks"),
            ("YES", "Embedded copyright metadata"),
            ("YES", "Personal wall display"),
            ("YES", "Personal gifts allowed"),
        ],
        "NO RESALE • NO COMMERCIAL USE • COPYRIGHT RETAINED",
        output / "04-authenticity-license.jpg",
    ))
    return outputs
