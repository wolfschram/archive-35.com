import importlib.util
import json
import re
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GENERATOR_PATH = ROOT / "06_Automation/scripts/generate_printable_pages.py"


def load_generator():
    spec = importlib.util.spec_from_file_location(
        "generate_printable_pages", GENERATOR_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generates_one_crawlable_page_per_controlled_product(tmp_path):
    module = load_generator()
    spec = json.loads(module.SPEC_PATH.read_text())
    direct_ids = set(spec["campaign"]["advertised_product_ids"])
    generated = module.generate(tmp_path, as_of=date(2026, 7, 30))
    pages = sorted(tmp_path.glob("printable-*.html"))

    assert len(generated) == 16
    assert len(pages) == 15
    for page in pages:
        text = page.read_text()
        schemas = re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', text, re.S
        )
        assert len(schemas) == 1
        product = json.loads(schemas[0])
        assert product["@type"] == "Product"
        assert product["offers"]["price"] == "9.00"
        assert product["offers"]["priceValidUntil"] == "2026-08-06"
        sku = product["sku"]
        if sku in direct_ids:
            assert product["offers"]["url"] == product["mainEntityOfPage"]
            assert f'data-printable-sku="{sku}"' in text
            assert ">Buy direct · $9</button>" in text
            assert "International buyer? Buy on Etsy" in text
        else:
            assert "archive35photo.etsy.com/listing/" in product["offers"]["url"]
            assert 'class="btn btn-primary direct-printable-button"' in text
            assert " hidden>Buy direct · $9</button>" in text
            assert "Buy securely on Etsy · $9" in text
        assert "No physical print or frame." in text
        assert 'data-sale-price-usd="9"' in text
        assert "js/printable-sale.js?v=1" in text
        assert "js/printable-checkout.js?v=1" in text
        assert "{{" not in text

    sitemap = ET.parse(tmp_path / "sitemap-printables.xml")
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    assert len(sitemap.findall("s:url", namespace)) == 17


def test_bundle_page_is_truthful_and_links_to_live_etsy_listing():
    page = (ROOT / "printable-desert-wall-art-set-of-3.html").read_text()
    schema_text = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', page, re.S
    )
    schema = json.loads(schema_text[0])
    assert schema["offers"]["price"] == "13.50"
    assert schema["offers"]["priceValidUntil"] == "2026-08-06"
    assert "4546681551" in schema["offers"]["url"]
    assert "15 JPEG files" in page
    assert "No physical prints or frames" in page


def test_iceland_bundle_page_is_truthful_and_links_to_live_etsy_listing():
    page = (ROOT / "printable-iceland-wall-art-set-of-3.html").read_text()
    schema_text = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', page, re.S
    )
    schema = json.loads(schema_text[0])
    assert schema["offers"]["price"] == "13.50"
    assert schema["offers"]["priceValidUntil"] == "2026-08-06"
    assert "4546706397" in schema["offers"]["url"]
    assert "15 JPEG files" in page
    assert "No physical prints or frames" in page


def test_hub_links_to_every_generated_product_page():
    spec = json.loads(
        (ROOT / "Archive 35 Agent/experiments/etsy-digital-mvp.json").read_text()
    )
    hub = (ROOT / "printables.html").read_text()

    for product in spec["products"]:
        filename = f"printable-{product['web_slug']}.html"
        assert hub.count(f'href="{filename}"') == 1

    schemas = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', hub, re.S
    )
    collection = json.loads(schemas[0])
    items = collection["mainEntity"]["itemListElement"]
    assert len(items) == 17
    assert {item["item"]["offers"]["price"] for item in items} == {
        "9.00",
        "13.50",
    }
    assert {
        item["item"]["offers"]["priceValidUntil"] for item in items
    } == {"2026-08-06"}
    assert hub.count("data-sale-active-label=") == 17
    assert hub.count("data-price-usd=") == 17
    assert hub.count('class="btn btn-primary direct-printable-button"') == 5
    assert hub.count('data-printable-sku="') == 5
    assert "js/printable-checkout.js?v=1" in hub

    direct_ids = set(spec["campaign"]["advertised_product_ids"])
    direct_products = {
        product["product_id"]: product
        for product in spec["products"]
        if product["product_id"] in direct_ids
    }
    for item in items:
        sku = next(
            (
                product_id
                for product_id, product in direct_products.items()
                if product["etsy_title"].split(",", 1)[0] == item["item"]["name"]
            ),
            None,
        )
        if sku:
            assert item["item"]["offers"]["url"].startswith(
                "https://archive-35.com/printable-"
            )


def test_generator_restores_base_price_after_sale(tmp_path):
    module = load_generator()
    spec = json.loads(module.SPEC_PATH.read_text())
    direct_ids = set(spec["campaign"]["advertised_product_ids"])
    generated = module.generate(tmp_path, as_of=date(2026, 8, 7))

    pages = [path for path in generated if path.suffix == ".html"]
    assert len(pages) == 15
    for page in pages:
        text = page.read_text()
        schema_text = re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', text, re.S
        )
        product = json.loads(schema_text[0])
        assert product["offers"]["price"] == "12.00"
        assert "priceValidUntil" not in product["offers"]
        if product["sku"] in direct_ids:
            assert ">Buy direct · $12</button>" in text
            assert ">International buyer? Buy on Etsy</a>" in text
        else:
            assert ">Buy securely on Etsy · $12</a>" in text
        assert "<span data-printable-sale hidden>" in text
        assert "<span data-printable-base>" in text


def test_sale_controller_and_click_tracking_use_actual_offer_price():
    controller = (ROOT / "js/printable-sale.js").read_text()
    analytics = (ROOT / "js/analytics.js").read_text()
    homepage = (ROOT / "index.html").read_text()

    assert "2026-07-30T00:00:00-07:00" in controller
    assert "2026-08-07T00:00:00-07:00" in controller
    assert "element.dataset.priceUsd" in controller
    assert "restoreExpiredOfferPrices" in controller
    assert "delete value.priceValidUntil" in controller
    assert "Number(link.dataset.priceUsd || 12)" in analytics
    assert "price_usd: priceUsd" in analytics
    assert "value: priceUsd" in analytics
    assert "js/printable-sale.js?v=1" in homepage
    assert "Printables · from $9" in homepage


def test_committed_cloudflare_artifacts_match_generator(tmp_path):
    module = load_generator()
    generated = module.generate(tmp_path)

    for output in generated:
        committed = ROOT / output.name
        assert committed.is_file()
        assert committed.read_text() == output.read_text()


def test_primary_sitemap_contains_every_printable_url():
    module = load_generator()
    spec = json.loads(module.SPEC_PATH.read_text())
    sitemap = (ROOT / "sitemap.xml").read_text()
    expected = [
        *module.BUNDLE_PAGES,
        *(f"printable-{product['web_slug']}.html" for product in spec["products"]),
    ]

    for filename in expected:
        assert sitemap.count(f"https://archive-35.com/{filename}") == 1

    assert "sitemap-printables.xml" not in (ROOT / "robots.txt").read_text()
