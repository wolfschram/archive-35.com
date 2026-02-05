# Procedure: Deploy Website

## Prerequisites
- Changes made to 04_Website/dist/
- Local preview confirmed working

## Method 1: Archive-35 Studio (Recommended)
1. Open Archive-35 Studio
2. Go to "Website Control" tab
3. Click "Preview" to verify changes
4. Click "Deploy to Website"
5. Wait for deployment + tests
6. Verify success message

## Method 2: Terminal
```bash
cd "/Users/wolfgangschram/My Drive (wolf@schramfamily.com)/My Drive/Archive-35.com/04_Website/dist"

# Stage all changes
git add .

# Commit with message
git commit -m "Description of changes"

# Push to GitHub
git push origin main
```

## Method 3: Claude Desktop
Tell Claude: "Deploy website with message: [description]"

## Post-Deploy Checklist
- [ ] https://archive-35.com loads
- [ ] All pages accessible
- [ ] Images display correctly
- [ ] Buy links work (if Artelo connected)
- [ ] Mobile responsive

## Rollback
If something breaks:
```bash
git revert HEAD
git push origin main
```

Or restore from 09_Backups/
