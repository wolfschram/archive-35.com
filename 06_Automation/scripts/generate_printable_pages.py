#!/usr/bin/env python3
"""Generate truthful, crawlable pages for the controlled Etsy printables."""

from __future__ import annotations

import argparse
import html
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "Archive 35 Agent/experiments/etsy-digital-mvp.json"
SALE_PATH = ROOT / "Archive 35 Agent/experiments/etsy-printables-sale-evidence.json"
TEMPLATE_PATH = ROOT / "06_Automation/templates/printable-product.html"
BASE_URL = "https://archive-35.com"
BUNDLE_PAGES = [
    "printable-desert-wall-art-set-of-3.html",
    "printable-iceland-wall-art-set-of-3.html",
]


def _etsy_url(product: dict) -> str:
    return (
        "https://archive35photo.etsy.com/listing/"
        f"{product['etsy_listing_id']}/{product['etsy_listing_slug']}"
    )


def _sale_is_active(sale: dict, as_of: date | None = None) -> bool:
    current = as_of or date.today()
    return date.fromisoformat(sale["starts_on"]) <= current <= date.fromisoformat(
        sale["ends_on"]
    )


def _page_values(product: dict, sale: dict, sale_active: bool) -> dict[str, str]:
    title = product["etsy_title"].split(",", 1)[0]
    location = product["location"]
    artwork = product["artwork_title"]
    canonical = f"{BASE_URL}/printable-{product['web_slug']}.html"
    image_path = f"images/printables/{product['web_image']}"
    image_url = f"{BASE_URL}/{image_path}"
    description = (
        f"{title}: original photography from {location}. "
        "Instant download in five JPEG ratios. No physical print or frame."
    )
    product_description = (
        f"{artwork} is an original fine-art photograph made in {location}. "
        "Your Etsy purchase includes five high-resolution JPEG files sized "
        "for common frames."
    )
    schema = {
        "@context": "https://schema.org",
        "@type": "Product",
        "mainEntityOfPage": canonical,
        "name": product["etsy_title"],
        "description": description,
        "image": [image_url],
        "sku": product["product_id"],
        "brand": {"@type": "Brand", "name": "ARCHIVE-35"},
        "category": "Printable photography wall art",
        "offers": {
            "@type": "Offer",
            "url": _etsy_url(product),
            "price": "9.00" if sale_active else "12.00",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
        },
    }
    if sale_active:
        schema["offers"]["priceValidUntil"] = sale["ends_on"]
    plain_values = {
        "PAGE_TITLE": f"{title} | Instant Download | ARCHIVE-35",
        "META_DESCRIPTION": description,
        "CANONICAL_URL": canonical,
        "IMAGE_URL": image_url,
        "IMAGE_PATH": image_path,
        "IMAGE_ALT": f"{artwork}, printable photography from {location}",
        "LOCATION": location,
        "ARTWORK_TITLE": artwork,
        "PRODUCT_DESCRIPTION": product_description,
        "PRODUCT_ID": product["product_id"],
        "ETSY_URL": _etsy_url(product),
        "SALE_HIDDEN_ATTR": "" if sale_active else " hidden",
        "BASE_HIDDEN_ATTR": " hidden" if sale_active else "",
        "CURRENT_BUTTON_LABEL": (
            "Buy securely on Etsy · $9"
            if sale_active
            else "Buy securely on Etsy · $12"
        ),
        "CURRENT_PRICE_USD": "9" if sale_active else "12",
    }
    values = {key: html.escape(value, quote=True) for key, value in plain_values.items()}
    values["JSON_LD"] = json.dumps(schema, ensure_ascii=False, indent=2).replace(
        "</", "<\\/"
    )
    return values


def _render(template: str, values: dict[str, str]) -> str:
    page = template
    for key, value in values.items():
        page = page.replace(f"{{{{{key}}}}}", value)
    if "{{" in page or "}}" in page:
        raise ValueError("Unresolved printable template placeholder")
    return page


def _sitemap(products: list[dict], lastmod: str) -> str:
    urls = [
        "  <url>\n"
        f"    <loc>{BASE_URL}/{bundle_page}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        "    <changefreq>monthly</changefreq>\n"
        "    <priority>0.9</priority>\n"
        "  </url>"
        for bundle_page in BUNDLE_PAGES
    ]
    for product in products:
        location = f"{BASE_URL}/printable-{product['web_slug']}.html"
        urls.append(
            "  <url>\n"
            f"    <loc>{html.escape(location)}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            "    <changefreq>monthly</changefreq>\n"
            "    <priority>0.8</priority>\n"
            "  </url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )


def generate(output_dir: Path, as_of: date | None = None) -> list[Path]:
    spec = json.loads(SPEC_PATH.read_text())
    sale = json.loads(SALE_PATH.read_text())
    sale_active = _sale_is_active(sale, as_of)
    products = spec["products"]
    template = TEMPLATE_PATH.read_text()
    output_dir.mkdir(parents=True, exist_ok=True)
    generated = []
    for product in products:
        values = _page_values(product, sale, sale_active)
        output = output_dir / f"printable-{product['web_slug']}.html"
        output.write_text(_render(template, values))
        generated.append(output)
    sitemap = output_dir / "sitemap-printables.xml"
    sitemap.write_text(_sitemap(products, spec["web_lastmod"]))
    generated.append(sitemap)
    return generated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "_site",
        help="Directory that receives generated pages and sitemap",
    )
    args = parser.parse_args()
    generated = generate(args.output)
    print(
        f"[PRINTABLE PAGES] Generated {len(generated) - 1} pages "
        f"and {generated[-1].name}"
    )


if __name__ == "__main__":
    main()
