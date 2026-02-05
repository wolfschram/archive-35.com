# GitHub Pages Setup

## Repository
- Owner: wolfschram
- Name: archive-35.com
- URL: https://github.com/wolfschram/archive-35.com
- Visibility: Public (required for free GitHub Pages)

## Deployment

### Method: Push to main branch
Files in main branch are automatically deployed.

### Folder Structure
```
archive-35.com/              ← Repository root
├── index.html               ← Home page
├── gallery.html
├── collection.html
├── about.html
├── contact.html
├── search.html
├── CNAME                    ← Custom domain file
├── .nojekyll                ← Disable Jekyll processing
├── css/
│   └── styles.css
├── js/
│   └── main.js
├── data/
│   └── photos.json
└── images/
    └── grand-teton/
```

## Deploying Updates

### From Terminal
```bash
cd "/Users/wolfgangschram/My Drive (wolf@schramfamily.com)/My Drive/Archive-35.com/04_Website/dist"
git add .
git commit -m "Update description"
git push origin main
```

### From Archive-35 Studio
Click "Deploy to Website" button (when app is built)

## Settings
URL: https://github.com/wolfschram/archive-35.com/settings/pages

- Source: Deploy from a branch
- Branch: main
- Folder: / (root)
- Custom domain: archive-35.com
- Enforce HTTPS: ✓

## URLs
- GitHub Pages URL: https://wolfschram.github.io/archive-35.com
- Custom Domain: https://archive-35.com
- Custom Domain (www): https://www.archive-35.com
