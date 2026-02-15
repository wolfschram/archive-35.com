#!/bin/bash
# Archive-35 Build Script for Cloudflare Pages
# This replaces the inline build command
# Updated: 2026-02-09 - includes analytics.js, robots.txt, llms.txt, favicon, logos

set -e

echo "Building Archive-35..."

# Create output directory
mkdir -p _site

# CRITICAL: Sync gallery.html inline data from photos.json BEFORE copying
# This ensures the Cover Flow always has current photo data.
# See: sync_gallery_data.py and LESSONS_LEARNED.md for why this exists.
python3 sync_gallery_data.py || echo "WARNING: Gallery data sync failed — gallery.html may be stale"

# Copy HTML files (now includes freshly synced gallery.html)
cp *.html _site/ 2>/dev/null || true

# Copy CNAME
cp CNAME _site/ 2>/dev/null || true

# Clean stale _site/ subdirectories that may contain orphan data from previous builds
# (e.g., removed collections like "africa" or typo directories)
rm -rf _site/images _site/data _site/css _site/js _site/logos 2>/dev/null || true

# Copy static assets (fresh copy eliminates orphans)
cp -r css js images data logos _site/ 2>/dev/null || true

# Remove orphan image folders that exist on disk but are NOT in photos.json
# (e.g., deleted collections whose source images couldn't be removed due to permissions)
rm -rf _site/images/large-scale-photography-stitch 2>/dev/null || true
rm -rf _site/images/africa 2>/dev/null || true

# Copy prototype gallery assets (thumbs, labels, textures)
cp -r prototype _site/ 2>/dev/null || true
cp *.png _site/ 2>/dev/null || true

# Copy licensing assets (public-safe only: thumbnails, watermarked previews, terms page)
mkdir -p _site/09_Licensing/thumbnails _site/09_Licensing/watermarked _site/licensing
cp 09_Licensing/thumbnails/*.jpg _site/09_Licensing/thumbnails/ 2>/dev/null || true
cp 09_Licensing/watermarked/*.jpg _site/09_Licensing/watermarked/ 2>/dev/null || true
cp -r licensing/* _site/licensing/ 2>/dev/null || true

# Copy favicon
cp favicon.svg _site/ 2>/dev/null || true

# Copy root-level text files and sitemap (robots.txt, llms.txt, llms-full.txt, sitemap.xml)
cp robots.txt _site/ 2>/dev/null || true
cp llms.txt _site/ 2>/dev/null || true
cp llms-full.txt _site/ 2>/dev/null || true
cp sitemap.xml _site/ 2>/dev/null || true

# Copy API endpoint (machine-readable product feed for AI agents)
cp -r api _site/ 2>/dev/null || true

echo "Build complete! Output in _site/"
ls -la _site/
