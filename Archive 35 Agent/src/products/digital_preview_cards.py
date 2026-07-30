"""Create truthful, code-native Etsy preview cards for digital products."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SIZE = 2000
INK = "#171714"
PAPER = "#f1eee7"
ACCENT = "#b88a48"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    path = Path("/System/Library/Fonts/Supplemental") / name
    return ImageFont.truetype(str(path), size)


def _fit_photo(source: Path, box: tuple[int, int]) -> Image.Image:
    with Image.open(source) as original:
        image = original.convert("RGB")
    image.thumbnail(box, Image.Resampling.LANCZOS)
    return image


def _centered(draw: ImageDraw.ImageDraw, y: int, text: str, font, fill: str) -> None:
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((SIZE - box[2]) / 2, y), text, font=font, fill=fill)


def build_download_cover(source: str | Path, destination: str | Path) -> Path:
    """Create the primary image with an unambiguous digital-product label."""
    canvas = Image.new("RGB", (SIZE, SIZE), INK)
    photo = _fit_photo(Path(source), (1700, 1340))
    canvas.paste(photo, ((SIZE - photo.width) // 2, 300))
    draw = ImageDraw.Draw(canvas)
    _centered(draw, 75, "THE RESTLESS EYE", _font(42, True), PAPER)
    _centered(draw, 155, "DIGITAL DOWNLOAD", _font(92, True), ACCENT)
    _centered(draw, 1685, "5 HIGH-RESOLUTION JPG FILES", _font(52, True), PAPER)
    _centered(draw, 1770, "NO PHYSICAL ITEM • FRAME NOT INCLUDED", _font(43), PAPER)
    _centered(draw, 1880, "PRINT AT HOME OR WITH YOUR LOCAL LAB", _font(33), "#aaa79f")
    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "JPEG", quality=94, optimize=True)
    return output


def build_ratio_guide(destination: str | Path) -> Path:
    """Create a simple guide to the five included aspect-ratio files."""
    canvas = Image.new("RGB", (SIZE, SIZE), PAPER)
    draw = ImageDraw.Draw(canvas)
    _centered(draw, 100, "FIVE PRINT RATIOS INCLUDED", _font(82, True), INK)
    rows = [
        ("2:3", "4×6 • 8×12 • 12×18 • 20×30 • 24×36"),
        ("3:4", "6×8 • 9×12 • 12×16 • 18×24"),
        ("4:5", "8×10 • 12×15 • 16×20 • 24×30"),
        ("11:14", "11×14 • 22×28"),
        ("ISO", "A5 • A4 • A3 • A2 • A1"),
    ]
    for index, (ratio, sizes) in enumerate(rows):
        y = 365 + index * 245
        draw.rounded_rectangle((180, y, 1820, y + 175), 20, fill="#ffffff")
        draw.text((250, y + 36), ratio, font=_font(65, True), fill=ACCENT)
        draw.text((560, y + 53), sizes, font=_font(43), fill=INK)
    _centered(draw, 1710, "YOU RECEIVE 5 JPG FILES • 300 DPI", _font(46, True), INK)
    _centered(draw, 1800, "PERSONAL USE • INSTANT DOWNLOAD", _font(40), INK)
    _centered(draw, 1890, "NO PHYSICAL ITEM • FRAME NOT INCLUDED", _font(38), "#7a351f")
    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "JPEG", quality=94, optimize=True)
    return output
