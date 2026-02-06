#!/bin/bash
# Double-click this file to run Stripe setup
# (You may need to right-click > Open the first time)

cd "$(dirname "$0")"

echo "========================================="
echo "  Archive-35 Stripe Setup"
echo "========================================="
echo ""

# Step 1: Fetch existing products
echo "Step 1: Fetching existing products from Stripe..."
python3 06_Automation/scripts/stripe_setup.py --fetch

# Step 2: Create payment links
echo ""
echo "Step 2: Creating payment links..."
python3 06_Automation/scripts/stripe_setup.py --create-links

# Step 3: Export for website
echo ""
echo "Step 3: Exporting for website..."
python3 06_Automation/scripts/stripe_setup.py --export

echo ""
echo "========================================="
echo "  Done! Now push to GitHub."
echo "========================================="
echo ""
echo "Press any key to exit..."
read -n 1
