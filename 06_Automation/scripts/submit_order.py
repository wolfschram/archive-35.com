"""
Archive-35 Order Submission Tool
Submit orders to Pictorem after receiving Stripe payment.

Usage:
    python submit_order.py                    # Interactive mode
    python submit_order.py --list-orders      # Show recent Stripe orders
    python submit_order.py --order PI_xxx     # Process specific Stripe payment
"""

import os
import json
import argparse
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

import stripe
from pictorem_api import PictoremAPI

# Initialize APIs
stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
pictorem = PictoremAPI()

# Material to Pictorem preset mapping
MATERIAL_PRESETS = {
    'canvas': 'canvas_wrap',
    'metal': 'metal_single',
    'acrylic': 'acrylic',
    'paper': 'paper',
    'wood': 'wood'
}

# Photo originals location (update when using cloud storage)
ORIGINALS_BASE = Path(__file__).parent.parent.parent / '01_Portfolio'


def get_original_path(photo_id: str) -> str:
    """Get the path to original high-res image."""
    # Search in portfolio folders
    for gallery in ORIGINALS_BASE.iterdir():
        if gallery.is_dir():
            originals_dir = gallery / 'originals'
            if originals_dir.exists():
                for img in originals_dir.glob('*.jpg'):
                    if photo_id.lower() in img.stem.lower():
                        return str(img)
    return None


def list_recent_orders(limit: int = 10):
    """List recent Stripe payments."""
    print(f"\n📋 Recent Orders (last {limit})")
    print("=" * 80)

    payments = stripe.PaymentIntent.list(limit=limit)

    for pi in payments.data:
        if pi.status == 'succeeded':
            # Get charges for shipping info
            charges = stripe.Charge.list(payment_intent=pi.id, limit=1)

            created = datetime.fromtimestamp(pi.created).strftime('%Y-%m-%d %H:%M')
            amount = f"${pi.amount/100:.2f}"

            # Try to get metadata
            metadata = pi.metadata or {}
            photo = metadata.get('photo_title', 'Unknown')
            material = metadata.get('material', '?')
            size = metadata.get('size', '?')

            # Get shipping from charge
            shipping = None
            if charges.data:
                shipping = charges.data[0].shipping

            print(f"\n  ID: {pi.id}")
            print(f"  Date: {created}")
            print(f"  Amount: {amount}")
            print(f"  Product: {photo} - {material} {size}")
            if shipping:
                print(f"  Ship to: {shipping.name}")
                print(f"           {shipping.address.line1}")
                print(f"           {shipping.address.city}, {shipping.address.state} {shipping.address.postal_code}")
            print(f"  Status: ✅ Paid")

    print("\n" + "=" * 80)


def process_order(payment_id: str, dry_run: bool = True):
    """Process a Stripe payment into a Pictorem order."""
    print(f"\n🔄 Processing order: {payment_id}")

    # Get payment details
    try:
        pi = stripe.PaymentIntent.retrieve(payment_id)
    except stripe.error.InvalidRequestError:
        print(f"❌ Payment not found: {payment_id}")
        return

    if pi.status != 'succeeded':
        print(f"❌ Payment not completed: {pi.status}")
        return

    # Get charge for shipping details
    charges = stripe.Charge.list(payment_intent=payment_id, limit=1)
    if not charges.data:
        print("❌ No charge found for this payment")
        return

    charge = charges.data[0]
    shipping = charge.shipping

    if not shipping:
        print("❌ No shipping address found")
        return

    # Extract product details from metadata
    metadata = pi.metadata or {}
    photo_id = metadata.get('photo_id', '')
    photo_title = metadata.get('photo_title', 'Unknown')
    material = metadata.get('material', '')
    size = metadata.get('size', '')

    if not all([photo_id, material, size]):
        print("❌ Missing product details in metadata")
        print(f"   photo_id: {photo_id}")
        print(f"   material: {material}")
        print(f"   size: {size}")
        return

    # Find original image
    original_path = get_original_path(photo_id)
    if not original_path:
        print(f"⚠️  Original not found locally for {photo_id}")
        print("   You'll need to provide the image URL manually")
        image_url = input("   Enter image URL: ").strip()
    else:
        # For local files, we'd need to upload to cloud first
        # For now, prompt for URL
        print(f"📁 Local original: {original_path}")
        print("   Pictorem needs a public URL. Upload to cloud and enter URL:")
        image_url = input("   Enter image URL: ").strip()

    if not image_url:
        print("❌ Image URL required")
        return

    # Build Pictorem order
    print(f"\n📦 Order Details:")
    print(f"   Photo: {photo_title} ({photo_id})")
    print(f"   Material: {material}")
    print(f"   Size: {size}")
    print(f"   Ship to: {shipping.name}")
    print(f"            {shipping.address.line1}")
    if shipping.address.line2:
        print(f"            {shipping.address.line2}")
    print(f"            {shipping.address.city}, {shipping.address.state} {shipping.address.postal_code}")
    print(f"            {shipping.address.country}")

    # Get preset and build code
    preset = MATERIAL_PRESETS.get(material)
    if not preset:
        print(f"❌ Unknown material: {material}")
        return

    try:
        code = pictorem.build_from_preset(preset, size, 'horizontal')
    except Exception as e:
        print(f"❌ Error building code: {e}")
        return

    print(f"   Pictorem code: {code}")

    # Get price estimate
    print("\n💰 Getting price estimate...")
    price_result = pictorem.get_price(image_url, code)
    if price_result.get('success'):
        print(f"   Wholesale: ${price_result.get('price', 0):.2f}")
        print(f"   You charged: ${pi.amount/100:.2f}")
        print(f"   Your profit: ${(pi.amount/100) - float(price_result.get('price', 0)):.2f}")

    if dry_run:
        print("\n⚠️  DRY RUN - Order not submitted")
        print("   Run with --submit to actually place order")
        return

    # Submit order
    confirm = input("\n❓ Submit order to Pictorem? (yes/no): ").strip().lower()
    if confirm != 'yes':
        print("❌ Order cancelled")
        return

    print("\n📤 Submitting to Pictorem...")

    recipient = {
        'name': shipping.name,
        'address': shipping.address.line1,
        'address2': shipping.address.line2 or '',
        'city': shipping.address.city,
        'state': shipping.address.state,
        'zip': shipping.address.postal_code,
        'country': shipping.address.country
    }

    result = pictorem.send_order(image_url, code, recipient)

    if result.get('success'):
        print(f"✅ Order submitted!")
        print(f"   Order ID: {result.get('order_id', 'N/A')}")

        # Save order record
        save_order_record(payment_id, result, photo_title, material, size, shipping)
    else:
        print(f"❌ Order failed: {result.get('error', 'Unknown error')}")


def save_order_record(payment_id, pictorem_result, photo, material, size, shipping):
    """Save order to local log."""
    orders_path = Path(__file__).parent / 'orders.json'

    orders = []
    if orders_path.exists():
        with open(orders_path) as f:
            orders = json.load(f)

    orders.append({
        'date': datetime.now().isoformat(),
        'stripe_payment': payment_id,
        'pictorem_order': pictorem_result.get('order_id'),
        'photo': photo,
        'material': material,
        'size': size,
        'ship_to': {
            'name': shipping.name,
            'city': shipping.address.city,
            'state': shipping.address.state
        }
    })

    with open(orders_path, 'w') as f:
        json.dump(orders, f, indent=2)

    print(f"   Saved to: {orders_path}")


def interactive_mode():
    """Interactive order entry."""
    print("\n🖼️  Archive-35 Order Submission")
    print("=" * 50)

    # Get photo info
    print("\n1. Photo Information")
    photo_id = input("   Photo ID (e.g., GT001): ").strip()

    # Get material
    print("\n2. Select Material:")
    print("   1. Canvas Gallery Wrap")
    print("   2. Brushed Aluminum (Metal)")
    print("   3. Acrylic Face Mount")
    print("   4. Fine Art Paper")
    print("   5. Birch Wood Panel")

    material_choice = input("   Enter choice (1-5): ").strip()
    material_map = {'1': 'canvas', '2': 'metal', '3': 'acrylic', '4': 'paper', '5': 'wood'}
    material = material_map.get(material_choice, 'canvas')

    # Get size
    print("\n3. Enter Size (e.g., 24x16): ")
    size = input("   Size: ").strip()

    # Get image URL
    print("\n4. Image URL (must be publicly accessible):")
    image_url = input("   URL: ").strip()

    # Get shipping
    print("\n5. Shipping Address:")
    recipient = {
        'name': input("   Full Name: ").strip(),
        'address': input("   Street Address: ").strip(),
        'address2': input("   Apt/Suite (optional): ").strip(),
        'city': input("   City: ").strip(),
        'state': input("   State: ").strip(),
        'zip': input("   ZIP: ").strip(),
        'country': input("   Country (US/CA): ").strip() or 'US'
    }

    # Build code
    preset = MATERIAL_PRESETS.get(material)
    try:
        code = pictorem.build_from_preset(preset, size, 'horizontal')
    except Exception as e:
        print(f"❌ Error: {e}")
        return

    # Confirm
    print("\n" + "=" * 50)
    print("📦 Order Summary")
    print(f"   Photo: {photo_id}")
    print(f"   Material: {material}")
    print(f"   Size: {size}")
    print(f"   Code: {code}")
    print(f"   Ship to: {recipient['name']}, {recipient['city']}, {recipient['state']}")

    # Get price
    print("\n💰 Checking price...")
    price = pictorem.get_price(image_url, code)
    if price.get('success'):
        print(f"   Wholesale cost: ${price.get('price', 0):.2f}")

    # Submit
    confirm = input("\n❓ Submit order? (yes/no): ").strip().lower()
    if confirm != 'yes':
        print("❌ Cancelled")
        return

    print("\n📤 Submitting...")
    result = pictorem.send_order(image_url, code, recipient)

    if result.get('success'):
        print(f"✅ Success! Order ID: {result.get('order_id')}")
    else:
        print(f"❌ Failed: {result.get('error')}")


def main():
    parser = argparse.ArgumentParser(description='Archive-35 Order Submission')
    parser.add_argument('--list-orders', action='store_true', help='List recent Stripe payments')
    parser.add_argument('--order', type=str, help='Process specific Stripe payment ID')
    parser.add_argument('--submit', action='store_true', help='Actually submit (not dry run)')

    args = parser.parse_args()

    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not found in .env")
        return

    if args.list_orders:
        list_recent_orders()
    elif args.order:
        process_order(args.order, dry_run=not args.submit)
    else:
        interactive_mode()


if __name__ == '__main__':
    main()
