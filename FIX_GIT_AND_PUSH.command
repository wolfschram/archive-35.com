#!/bin/bash
# Double-click this file to fix git submodule issue and push
# (You may need to right-click > Open the first time)

cd "$(dirname "$0")"

echo "========================================="
echo "  Archive-35 Git Fix & Push"
echo "========================================="
echo ""

# Step 1: Remove embedded .git from dist (causes submodule issues)
echo "Step 1: Removing embedded .git from dist folder..."
rm -rf 04_Website/dist/.git
echo "Done."

# Step 2: Remove submodule tracking
echo ""
echo "Step 2: Removing submodule tracking..."
git rm --cached 04_Website/dist 2>/dev/null || true

# Step 3: Re-add dist as regular folder
echo ""
echo "Step 3: Adding dist as regular folder..."
git add 04_Website/dist/

# Step 4: Add all other changes
echo ""
echo "Step 4: Adding all changes..."
git add -A

# Step 5: Commit
echo ""
echo "Step 5: Committing..."
git commit -m "Fix buy button, add Stripe integration, remove dist submodule"

# Step 6: Push
echo ""
echo "Step 6: Pushing to GitHub..."
git push origin main

echo ""
echo "========================================="
echo "  Done!"
echo "========================================="
echo ""
echo "Press any key to exit..."
read -n 1
