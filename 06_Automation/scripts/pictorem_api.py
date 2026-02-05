"""
Pictorem API Integration for Archive-35
API Docs: https://www.pictorem.com/artflow/docs/

Handles print-on-demand orders:
- Validate product configurations
- Get pricing and lead times
- Submit orders with images
- Track order status
"""

import os
import requests
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from project root
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)


class PictoremAPI:
    """Pictorem Print-on-Demand API Client"""

    BASE_URL = "https://www.pictorem.com/artflow"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('PICTOREM_API_KEY')
        if not self.api_key:
            raise ValueError("PICTOREM_API_KEY not found. Set in .env or pass directly.")

        self.headers = {
            'artFlowKey': self.api_key
        }

    def _post(self, endpoint: str, data: dict) -> dict:
        """Make POST request to API"""
        url = f"{self.BASE_URL}/{endpoint}/"
        try:
            response = requests.post(url, headers=self.headers, data=data, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {'status': False, 'msg': {'error': [str(e)]}}

    def validate_preorder(self, preorder_code: str, border_color: str = 'ffffff') -> dict:
        """
        Validate product configuration before ordering.

        Args:
            preorder_code: e.g., "1|canvas|stretched|horizontal|24|16|semigloss|c15"
            border_color: Hex color for border (default white)

        Returns:
            dict with status (True/False) and validation info
        """
        return self._post('validatepreorder', {
            'preordercode': preorder_code,
            'bordercolorhex': border_color
        })

    def get_price(self, preorder_code: str, country: str = 'USA', province: str = '') -> dict:
        """
        Get pricing for product configuration.

        Args:
            preorder_code: Product configuration string
            country: Delivery country (USA, Canada, etc.)
            province: Delivery state/province

        Returns:
            dict with pricing breakdown in USD
        """
        return self._post('getprice', {
            'preordercode': preorder_code,
            'deliverycountry': country,
            'deliveryprovince': province
        })

    def get_lead_time(self, preorder_code: str) -> dict:
        """
        Get production lead time.

        Args:
            preorder_code: Product configuration string

        Returns:
            dict with productionLeadTime in days
        """
        return self._post('getleadtime', {
            'preordercode': preorder_code
        })

    def send_order(self, delivery_info: dict, order_items: list, comment: str = '') -> dict:
        """
        Submit order to Pictorem.

        Args:
            delivery_info: dict with keys:
                - firstname, lastname (required)
                - address1, city, province, country, cp (required)
                - company, address2, phone (optional)
            order_items: list of dicts with keys:
                - code: preorder code string
                - fileurl: URL to image file
                - filetype: jpg, png, or tiff (default jpg)
                - bordercolorhex: border color (default ffffff)
            comment: Optional order comment

        Returns:
            dict with orderid if successful
        """
        data = {
            'ordercomment': comment,
            'deliveryInfo[firstname]': delivery_info['firstname'],
            'deliveryInfo[lastname]': delivery_info['lastname'],
            'deliveryInfo[company]': delivery_info.get('company', ''),
            'deliveryInfo[address1]': delivery_info['address1'],
            'deliveryInfo[address2]': delivery_info.get('address2', ''),
            'deliveryInfo[city]': delivery_info['city'],
            'deliveryInfo[province]': delivery_info['province'],
            'deliveryInfo[country]': delivery_info['country'],
            'deliveryInfo[cp]': delivery_info['cp'],
            'deliveryInfo[phone]': delivery_info.get('phone', '')
        }

        for i, item in enumerate(order_items):
            data[f'orderList[{i}][code]'] = item['code']
            data[f'orderList[{i}][fileurl]'] = item['fileurl']
            data[f'orderList[{i}][filetype]'] = item.get('filetype', 'jpg')
            data[f'orderList[{i}][bordercolorhex]'] = item.get('bordercolorhex', 'ffffff')

        return self._post('sendorder', data)

    def build_product_list(self, preorder_code: str) -> dict:
        """
        Get available product options for a configuration.

        Args:
            preorder_code: Partial configuration (e.g., "1|canvas")

        Returns:
            dict with available products and options
        """
        return self._post('buildproductlist', {
            'preordercode': preorder_code
        })


# ===================
# HELPER FUNCTIONS
# ===================

def build_code(
    copies: int = 1,
    material: str = 'canvas',
    product_type: str = 'stretched',
    orientation: str = 'horizontal',
    width: int = 24,
    height: int = 16,
    options: list = None
) -> str:
    """
    Build a preorder code string.

    Example:
        build_code(1, 'canvas', 'stretched', 'horizontal', 24, 16, ['semigloss', 'mirrorimage', 'c15'])
        -> "1|canvas|stretched|horizontal|24|16|semigloss|mirrorimage|c15"
    """
    parts = [str(copies), material, product_type, orientation, str(width), str(height)]
    if options:
        parts.extend(options)
    return '|'.join(parts)


# Common product presets
PRESETS = {
    'canvas_gallery_wrap': {
        'material': 'canvas',
        'type': 'stretched',
        'options': ['semigloss', 'mirrorimage', 'c15']
    },
    'canvas_thin': {
        'material': 'canvas',
        'type': 'stretched',
        'options': ['semigloss', 'mirrorimage', 'c075']
    },
    'metal_brushed': {
        'material': 'metal',
        'type': 'al',
        'options': ['standoff']
    },
    'metal_white': {
        'material': 'metal',
        'type': 'alw',
        'options': ['standoff']
    },
    'metal_hd': {
        'material': 'metal',
        'type': 'hd',
        'options': []
    },
    'acrylic_standard': {
        'material': 'acrylic',
        'type': 'da16',
        'options': ['standoff']
    },
    'acrylic_thick': {
        'material': 'acrylic',
        'type': 'ac4',
        'options': ['standoff']
    },
    'fine_art_paper': {
        'material': 'paper',
        'type': 'art',
        'options': []
    },
    'photo_glossy': {
        'material': 'paper',
        'type': 'glossphoto',
        'options': []
    },
    'wood_print': {
        'material': 'wood',
        'type': 'ru14',
        'options': []
    }
}


def build_from_preset(preset_name: str, width: int, height: int, copies: int = 1) -> str:
    """Build code from a preset configuration."""
    if preset_name not in PRESETS:
        raise ValueError(f"Unknown preset: {preset_name}. Available: {list(PRESETS.keys())}")

    preset = PRESETS[preset_name]
    orientation = 'horizontal' if width > height else ('vertical' if height > width else 'square')

    return build_code(
        copies=copies,
        material=preset['material'],
        product_type=preset['type'],
        orientation=orientation,
        width=width,
        height=height,
        options=preset['options']
    )


# ===================
# TEST
# ===================

if __name__ == '__main__':
    print("Pictorem API Test")
    print("=" * 50)

    try:
        api = PictoremAPI()
        print("✅ API client initialized")
    except ValueError as e:
        print(f"❌ Error: {e}")
        exit(1)

    # Test with a 24x16 canvas
    code = build_from_preset('canvas_gallery_wrap', 24, 16)
    print(f"\nTest product: {code}")

    # Validate
    result = api.validate_preorder(code)
    if result.get('status'):
        print("✅ Configuration valid")
    else:
        print(f"❌ Validation failed: {result.get('msg')}")
        exit(1)

    # Get price
    price = api.get_price(code)
    if price.get('status'):
        subtotal = price['worksheet']['price']['subTotal']
        print(f"✅ Wholesale price: ${subtotal:.2f} USD")
    else:
        print(f"❌ Price error: {price.get('msg')}")

    # Get lead time
    lead = api.get_lead_time(code)
    if lead.get('status'):
        days = lead['data']['productionLeadTime']
        print(f"✅ Production: {days} days")
    else:
        print(f"❌ Lead time error: {lead.get('msg')}")

    print("\n" + "=" * 50)
    print("API connection successful!")
