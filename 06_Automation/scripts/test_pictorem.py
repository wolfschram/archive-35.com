"""
Comprehensive test for Pictorem API.
Tests various product types and custom sizes.
"""

from pictorem_api import PictoremAPI, build_code, build_from_preset, PRESETS

def main():
    print("=" * 60)
    print("PICTOREM API - COMPREHENSIVE TEST")
    print("=" * 60)

    api = PictoremAPI()

    # Test all presets
    test_sizes = [
        (24, 16, "Standard landscape"),
        (16, 24, "Standard portrait"),
        (20, 20, "Square"),
        (48, 16, "Panoramic 3:1"),
        (36, 24, "Large landscape"),
    ]

    print("\n📦 TESTING PRODUCT PRESETS")
    print("-" * 60)

    for preset_name in PRESETS:
        print(f"\n{preset_name.upper()}")
        code = build_from_preset(preset_name, 24, 16)

        valid = api.validate_preorder(code)
        if valid.get('status'):
            price = api.get_price(code)
            if price.get('status'):
                subtotal = price['worksheet']['price']['subTotal']
                lead = api.get_lead_time(code)
                days = lead.get('data', {}).get('productionLeadTime', '?')
                print(f"  24x16: ${subtotal:.2f} | {days} days")
            else:
                print(f"  ❌ Price error")
        else:
            print(f"  ❌ Invalid config")

    print("\n\n📐 TESTING CUSTOM SIZES (Canvas Gallery Wrap)")
    print("-" * 60)

    for width, height, desc in test_sizes:
        code = build_from_preset('canvas_gallery_wrap', width, height)
        valid = api.validate_preorder(code)
        if valid.get('status'):
            price = api.get_price(code)
            if price.get('status'):
                subtotal = price['worksheet']['price']['subTotal']
                print(f"  {width}x{height} ({desc}): ${subtotal:.2f}")
            else:
                print(f"  {width}x{height}: Price error")
        else:
            print(f"  {width}x{height}: Invalid")

    print("\n\n✅ TEST COMPLETE")
    print("=" * 60)

if __name__ == '__main__':
    main()
