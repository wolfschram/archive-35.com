#!/bin/bash
# Archive-35 Build Script for Cloudflare Pages
# This replaces the inline build command
# Updated: 2026-02-08 - includes robots.txt, llms.txt, favicon, logos

set -e

echo "Building Archive-35..."

# Create output directory
mkdir -p _site

# Copy HTML files
cp *.html _site/ 2>/dev/null || true

# Copy CNAME
cp CNAME _site/ 2>/dev/null || true

# Copy static assets
cp -r css js images data logos _site/ 2>/dev/null || true

# Copy favicon
cp favicon.svg _site/ 2>/dev/null || true

# Copy root-level text files (robots.txt, llms.txt)
cp robots.txt _site/ 2>/dev/null || true
cp llms.txt _site/ 2>/dev/null || true

echo "Build complete! Output in _site/"
ls -la _site/
