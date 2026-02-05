"""
Archive-35 Stripe Payment Setup
Creates products, prices, and payment links for all photos dynamically.

Usage:
    python stripe_setup.py --create-products    # Create all products/prices in Stripe
    python stripe_setup.py --create-links       # Create payment links for all products
    python stripe_setup.py --export             # Export links to JSON for website
    python stripe_setup.py --test               # Test with one product
"""

import os
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

import stripe

# Initialize Stripe
stripe.api_key = os.getenv('STRIPE_SECRET_KEY')

# ===================
# PRICING CONFIGURATION (2.5x wholesale)
# ===================
MARKUP = 2.5

PRODUCTS = {
    'canvas': {
        'name': 'Canvas Gallery Wrap',
        'description': 'Museum-quality canvas on 1.5" stretcher bars. Satin finish, ready to hang.',
        'wholesale': {
            '12x8': 42, '16x12': 56, '20x16': 68, '24x16': 76,
            '24x18': 82, '30x20': 98, '36x24': 122, '40x30': 148,
            '48x32': 178, '60x40': 228
        }
    },
    'metal': {
        'name': 'Brushed Aluminum',
        'description': 'HD sublimation on brushed aluminum with float mount. Vivid colors, modern look.',
        'wholesale': {
            '12x8': 52, '16x12': 72, '20x16': 88, '24x16': 96,
            '24x18': 104, '30x20': 128, '36x24': 158, '40x30': 198,
            '48x32': 248, '60x40': 328
        }
    },
    'acrylic': {
        'name': 'Acrylic Face Mount',
        'description': 'Face-mounted on 1/4" crystal-clear acrylic with float mount. Luminous gallery finish.',
        'wholesale': {
            '12x8': 78, '16x12': 102, '20x16': 128, '24x16': 138,
            '24x18': 148, '30x20': 188, '36x24': 238, '40x30': 298,
            '48x32': 378, '60x40': 498
        }
    },
    'paper': {
        'name': 'Fine Art Paper',
        'description': 'Archival Hahnemühle Photo Rag 308gsm. Museum-quality, unframed.',
        'wholesale': {
            '12x8': 24, '16x12': 32, '20x16': 38, '24x16': 42,
            '24x18': 46, '30x20': 58, '36x24': 72, '40x30': 92,
            '48x32': 118, '60x40': 158
        }
    },
    'wood': {
        'name': 'Birch Wood Panel',
        'description': 'HD print on natural birch wood. Organic texture, ready to hang.',
        'wholesale': {
            '12x8': 48, '16x12': 62, '20x16': 72, '24x16': 76,
            '24x18': 82, '30x20': 98, '36x24': 122, '40x30': 148
        }
    }
}

SIZES = ['12x8', '16x12', '20x16', '24x16', '24x18', '30x20', '36x24', '40x30', '48x32', '60x40']

def get_retail_price(material: str, size: str) -> int:
    """Get retail price in cents (for Stripe)."""
    wholesale = PRODUCTS[material]['wholesale'].get(size)
    if not wholesale:
        return None
    return int(wholesale * MARKUP * 100)  # Convert to cents


def load_photos() -> list:
    """Load photo data from the website's photos.json."""
    photos_path = Path(__file__).parent.parent.parent / '04_Website' / 'dist' / 'data' / 'photos.json'
    if photos_path.exists():
        with open(photos_path) as f:
            data = json.load(f)
            return data.get('photos', [])
    return []


def create_stripe_product(photo: dict, material: str) -> str:
    """Create a Stripe product for a photo/material combo."""
    product_config = PRODUCTS[material]

    product = stripe.Product.create(
        name=f"{photo['title']} - {product_config['name']}",
        description=product_config['description'],
        metadata={
            'photo_id': photo['id'],
            'photo_title': photo['title'],
            'material': material,
            'archive35': 'true'
        },
        images=[photo.get('full', photo.get('thumbnail', ''))][:1]  # Stripe allows max 8 images
    )

    print(f"  Created product: {product.name} ({product.id})")
    return product.id


def create_stripe_price(product_id: str, material: str, size: str) -> str:
    """Create a Stripe price for a product/size combo."""
    price_cents = get_retail_price(material, size)
    if not price_cents:
        return None

    price = stripe.Price.create(
        product=product_id,
        unit_amount=price_cents,
        currency='usd',
        metadata={
            'material': material,
            'size': size
        }
    )

    return price.id


def create_payment_link(price_id: str, photo_title: str, material: str, size: str) -> str:
    """Create a Stripe Payment Link."""
    try:
        link = stripe.PaymentLink.create(
            line_items=[{'price': price_id, 'quantity': 1}],
            billing_address_collection='required',
            shipping_address_collection={'allowed_countries': ['US', 'CA']},
            phone_number_collection={'enabled': True},
            # Note: consent_collection requires terms_of_service URL in Stripe settings
            # consent_collection={'terms_of_service': 'required'},
            after_completion={
                'type': 'redirect',
                'redirect': {'url': 'https://archive-35.com/thank-you.html'}
            },
            metadata={
                'photo_title': photo_title,
                'material': material,
                'size': size
            }
        )
        return link.url
    except stripe.error.StripeError as e:
        print(f"    Error creating link: {e}")
        return None


def setup_all_products():
    """Create all products and prices in Stripe."""
    photos = load_photos()
    if not photos:
        print("No photos found. Using test photo.")
        photos = [{'id': 'TEST001', 'title': 'Test Photo', 'full': ''}]

    results = {}

    for photo in photos:
        print(f"\nProcessing: {photo['title']}")
        results[photo['id']] = {}

        for material in PRODUCTS:
            product_id = create_stripe_product(photo, material)
            results[photo['id']][material] = {
                'product_id': product_id,
                'prices': {}
            }

            for size in SIZES:
                price_id = create_stripe_price(product_id, material, size)
                if price_id:
                    results[photo['id']][material]['prices'][size] = price_id
                    print(f"    {material} {size}: ${get_retail_price(material, size)/100:.0f}")

    # Save results
    output_path = Path(__file__).parent / 'stripe_products.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Products saved to {output_path}")
    return results


def create_all_payment_links():
    """Create payment links for all products."""
    products_path = Path(__file__).parent / 'stripe_products.json'
    if not products_path.exists():
        print("Run --create-products first")
        return

    with open(products_path) as f:
        products = json.load(f)

    photos = load_photos()
    photo_titles = {p['id']: p['title'] for p in photos}

    links = {}

    for photo_id, materials in products.items():
        print(f"\nCreating links for: {photo_titles.get(photo_id, photo_id)}")
        links[photo_id] = {}

        for material, data in materials.items():
            links[photo_id][material] = {}

            for size, price_id in data['prices'].items():
                link_url = create_payment_link(
                    price_id,
                    photo_titles.get(photo_id, photo_id),
                    material,
                    size
                )
                if link_url:
                    links[photo_id][material][size] = link_url
                    print(f"    {material} {size}: {link_url}")

    # Save links
    output_path = Path(__file__).parent / 'stripe_payment_links.json'
    with open(output_path, 'w') as f:
        json.dump(links, f, indent=2)

    print(f"\n✅ Payment links saved to {output_path}")
    return links


def export_for_website():
    """Export payment links in format ready for website."""
    links_path = Path(__file__).parent / 'stripe_payment_links.json'
    if not links_path.exists():
        print("Run --create-links first")
        return

    with open(links_path) as f:
        links = json.load(f)

    # Export to website JS directory
    output_path = Path(__file__).parent.parent.parent / '04_Website' / 'dist' / 'js' / 'stripe-links.js'

    js_content = f"""// Auto-generated Stripe Payment Links
// Generated: {__import__('datetime').datetime.now().isoformat()}
// DO NOT EDIT MANUALLY

const STRIPE_LINKS = {json.dumps(links, indent=2)};

// Export for product selector
if (typeof window !== 'undefined') {{
    window.STRIPE_LINKS = STRIPE_LINKS;
}}
"""

    with open(output_path, 'w') as f:
        f.write(js_content)

    print(f"✅ Exported to {output_path}")
    print(f"   Add this to your HTML: <script src=\"js/stripe-links.js\"></script>")


def test_single_product():
    """Test with a single product."""
    print("Testing Stripe connection...")

    # Test connection
    try:
        account = stripe.Account.retrieve()
        print(f"✅ Connected to Stripe account: {account.get('business_profile', {}).get('name', account.id)}")
    except stripe.error.AuthenticationError:
        print("❌ Invalid API key")
        return

    # Create test product
    print("\nCreating test product...")
    product = stripe.Product.create(
        name="Archive-35 Test - Canvas 24x16",
        description="Test product - can be deleted",
        metadata={'test': 'true', 'archive35': 'true'}
    )
    print(f"  Product ID: {product.id}")

    # Create test price
    price = stripe.Price.create(
        product=product.id,
        unit_amount=19000,  # $190.00
        currency='usd'
    )
    print(f"  Price ID: {price.id}")

    # Create test payment link
    link = stripe.PaymentLink.create(
        line_items=[{'price': price.id, 'quantity': 1}],
        billing_address_collection='required',
        shipping_address_collection={'allowed_countries': ['US', 'CA']},
    )
    print(f"  Payment Link: {link.url}")

    print("\n✅ Test successful! You can delete the test product in Stripe Dashboard.")
    print(f"   Test link: {link.url}")


def main():
    parser = argparse.ArgumentParser(description='Archive-35 Stripe Setup')
    parser.add_argument('--create-products', action='store_true', help='Create products and prices')
    parser.add_argument('--create-links', action='store_true', help='Create payment links')
    parser.add_argument('--export', action='store_true', help='Export links for website')
    parser.add_argument('--test', action='store_true', help='Test with single product')
    parser.add_argument('--all', action='store_true', help='Run all steps')

    args = parser.parse_args()

    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not found in .env")
        return

    if args.test:
        test_single_product()
    elif args.create_products:
        setup_all_products()
    elif args.create_links:
        create_all_payment_links()
    elif args.export:
        export_for_website()
    elif args.all:
        setup_all_products()
        create_all_payment_links()
        export_for_website()
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
