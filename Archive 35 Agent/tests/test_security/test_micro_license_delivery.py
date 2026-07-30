from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[3]
SERVE = ROOT / "functions/api/micro-license/serve.js"
DOWNLOAD = ROOT / "functions/api/micro-license/download.js"
CHECKOUT = ROOT / "functions/api/micro-license/checkout.js"
WEBHOOK = ROOT / "functions/api/stripe-webhook.js"
THANK_YOU = ROOT / "thank-you.html"
MICRO_PAGE = ROOT / "micro-licensing.html"
ATTACK_HARNESS = Path(__file__).with_name("micro_license_attack_harness.mjs")


def test_serve_derives_the_r2_key_from_paid_session_metadata():
    source = SERVE.read_text()
    assert 'meta.orderType !== "micro-license"' in source
    assert "`micro/${tier}/${imageId}.jpg`" in source
    assert 'url.searchParams.get("key")' not in source
    assert "R2_BUCKET.get(entitlement.key)" in source


def test_micro_delivery_never_falls_back_to_originals():
    source = DOWNLOAD.read_text()
    assert "R2_BUCKET.head(microKey)" in source
    assert "`originals/${filename}`" not in source
    assert "serve?session_id=${sessionId}`" in source
    assert "&key=" not in source
    assert 'JSON.stringify({ error: "Download link expired"' in source


def test_checkout_rejects_path_like_image_ids():
    source = CHECKOUT.read_text()
    assert "VALID_IMAGE_ID.test(image_id)" in source
    assert 'JSON.stringify({ error: "Invalid image_id" })' in source
    assert "await env.ORIGINALS.head(deliveryKey)" in source
    assert '"This image is not yet available for instant download"' in source


def test_micro_order_never_falls_through_to_print_fulfillment():
    source = WEBHOOK.read_text()
    route = source.index("if (orderType === 'micro-license')")
    physical = source.index("PRINT ORDER — physical fulfillment")
    assert route < physical
    assert "orderType: 'micro-license'" in source[route:physical]


def test_thank_you_page_exposes_payment_gated_download():
    source = THANK_YOU.read_text()
    assert "loadMicroLicense(urlParams.get('session_id'))" in source
    assert "/api/micro-license/download?session_id=" in source
    assert 'id="micro-download-link"' in source


def test_public_test_mode_and_legacy_checkout_attacks_are_blocked():
    subprocess.run(
        ["node", str(ATTACK_HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    page = MICRO_PAGE.read_text()
    assert "/api/create-checkout-session" not in page
