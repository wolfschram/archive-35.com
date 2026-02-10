#!/bin/bash
# Archive-35 Build Script for Cloudflare Pages
# This replaces the inline build command
# Updated: 2026-02-09 - includes analytics.js, robots.txt, llms.txt, favicon, logos

set -e

echo "Building Archive-35..."

# Create output directory
mkdir -p _site

# Copy HTML files
cp *.html _site/ 2>/dev/null || true

# Copy CNAME
cp CNAME _site/ 2>/dev/null || true

# Copy static assets (includes analytics.js)
cp -r css js images data logos _site/ 2>/dev/null || true

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

# Copy root-level text files and sitemap (robots.txt, llms.txt, sitemap.xml)
cp robots.txt _site/ 2>/dev/null || true
cp llms.txt _site/ 2>/dev/null || true
cp sitemap.xml _site/ 2>/dev/null || true

echo "Build complete! Output in _site/"
ls -la _site/
