import importlib.util
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "Archive 35 Agent/scripts/package_direct_printables.py"
SPEC = ROOT / "Archive 35 Agent/experiments/etsy-digital-mvp.json"

module_spec = importlib.util.spec_from_file_location("direct_packages", SCRIPT)
direct_packages = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(direct_packages)


def test_advertised_products_are_the_five_controlled_singles():
    spec = json.loads(SPEC.read_text())
    products = direct_packages.advertised_products(spec)
    assert [product["product_id"] for product in products] == [
        "A35-DIG-ANT-0001",
        "A35-DIG-ICE-0001",
        "A35-DIG-TAN-0001",
        "A35-DIG-TET-0001",
        "A35-DIG-DUN-0001",
    ]


def test_builds_verified_package_without_preview_assets(tmp_path):
    spec = json.loads(SPEC.read_text())
    product = direct_packages.advertised_products(spec)[0]
    result = direct_packages.build_package(product, tmp_path)

    package = tmp_path / result["filename"]
    assert result["source_file_count"] == 5
    assert result["price_usd"] == 9.0
    assert result["r2_key"].startswith(f"printables/{result['sku']}/")

    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        assert len(names) == 6
        assert "Archive-35/README-LICENSE.txt" in names
        assert not any("preview" in name.lower() for name in names)
        assert archive.testzip() is None
