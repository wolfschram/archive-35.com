import importlib.util
import json
import re
import xml.etree.ElementTree as ET
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
    generated = module.generate(tmp_path)
    pages = sorted(tmp_path.glob("printable-*.html"))

    assert len(generated) == 11
    assert len(pages) == 10
    for page in pages:
        text = page.read_text()
        schemas = re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', text, re.S
        )
        assert len(schemas) == 1
        product = json.loads(schemas[0])
        assert product["@type"] == "Product"
        assert product["offers"]["price"] == "12.00"
        assert "archive35photo.etsy.com/listing/" in product["offers"]["url"]
        assert "No physical print or frame." in text
        assert "{{" not in text

    sitemap = ET.parse(tmp_path / "sitemap-printables.xml")
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    assert len(sitemap.findall("s:url", namespace)) == 11


def test_bundle_page_is_truthful_and_links_to_live_etsy_listing():
    page = (ROOT / "printable-desert-wall-art-set-of-3.html").read_text()
    schema_text = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', page, re.S
    )
    schema = json.loads(schema_text[0])
    assert schema["offers"]["price"] == "18.00"
    assert "4546681551" in schema["offers"]["url"]
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


def test_committed_cloudflare_artifacts_match_generator(tmp_path):
    module = load_generator()
    generated = module.generate(tmp_path)

    for output in generated:
        committed = ROOT / output.name
        assert committed.is_file()
        assert committed.read_text() == output.read_text()
