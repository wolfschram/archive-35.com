from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / "functions/api/printable/catalog.js"
CHECKOUT = ROOT / "functions/api/printable/checkout.js"
DOWNLOAD = ROOT / "functions/api/printable/download.js"
SERVE = ROOT / "functions/api/printable/serve.js"
WEBHOOK = ROOT / "functions/api/stripe-webhook.js"
THANK_YOU = ROOT / "thank-you.html"
HARNESS = Path(__file__).with_name("printable_checkout_attack_harness.mjs")


def test_server_catalog_controls_price_storage_and_tax_category():
    catalog = CATALOG.read_text()
    checkout = CHECKOUT.read_text()
    assert "currentPriceCents" in checkout
    assert "body?.price" not in checkout
    assert "product.r2Key" in checkout
    assert "stored.size !== product.bytes" in checkout
    assert "stored.customMetadata?.sha256 !== product.sha256" in checkout
    assert '"txcd_10501000"' in checkout
    assert '"shipping_address_collection[allowed_countries][0]", "US"' in checkout
    assert "PRINTABLE_PRODUCTS" in catalog


def test_delivery_uses_paid_session_entitlement_and_streams_exact_zip():
    catalog = CATALOG.read_text()
    checkout = CHECKOUT.read_text()
    download = DOWNLOAD.read_text()
    serve = SERVE.read_text()
    assert 'metadata.orderType !== "printable"' in catalog
    assert 'session.payment_status !== "paid"' in catalog
    assert "subtotal !== 900 && subtotal !== 1200" in catalog
    assert "metadataPrice !== subtotal" in catalog
    assert "discount !== 0" in catalog
    assert "total < subtotal" in catalog
    assert 'params.append("allow_promotion_codes"' not in checkout
    assert "hasValidPrintableEntitlement(session)" in download
    assert "hasValidPrintableEntitlement(session)" in serve
    assert "env.ORIGINALS.get(product.r2Key)" in serve
    assert "new Response(object.body" in serve
    assert 'url.searchParams.get("key")' not in serve


def test_printable_never_falls_through_to_physical_fulfillment():
    source = WEBHOOK.read_text()
    route = source.index("if (orderType === 'printable')")
    physical = source.index("PRINT ORDER — physical fulfillment")
    assert route < physical


def test_thank_you_page_loads_payment_gated_printable_download():
    source = THANK_YOU.read_text()
    assert "loadPrintable(urlParams.get('session_id'))" in source
    assert "/api/printable/download?session_id=" in source
    assert 'id="printable-download-link"' in source


def test_attack_harness():
    subprocess.run(
        [
            "node",
            "--experimental-default-type=module",
            str(HARNESS),
            str(ROOT),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
