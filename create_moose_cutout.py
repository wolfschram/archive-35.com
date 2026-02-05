#!/usr/bin/env python3
"""
Create a moose head cutout with transparency for 3D layering effect
"""
from PIL import Image, ImageFilter
import numpy as np

# Load the hero image
img_path = "images/grand-teton/WOLF7514-full.jpg"
img = Image.open(img_path)
width, height = img.size
print(f"Image size: {width}x{height}")

# Convert to numpy array for processing
arr = np.array(img)

# The moose is darker than the background
# Convert to grayscale for analysis
gray = np.mean(arr, axis=2)

# Find the darkest regions (moose body)
threshold = np.percentile(gray, 22)
dark_mask = gray < threshold

# Create output with alpha channel - just head/upper body region
head_region = Image.new('RGBA', (width, height), (0, 0, 0, 0))

# The head is roughly in upper-center
head_top = int(height * 0.08)
head_bottom = int(height * 0.58)
head_left = int(width * 0.32)
head_right = int(width * 0.56)

for y in range(head_top, head_bottom):
    for x in range(head_left, head_right):
        if dark_mask[y, x]:
            r, g, b = arr[y, x]
            head_region.putpixel((x, y), (r, g, b, 255))

# Slight blur to soften edges
head_region = head_region.filter(ImageFilter.GaussianBlur(radius=0.8))

# Save
head_path = "images/moose-foreground.png"
head_region.save(head_path, 'PNG')
print(f"Saved moose cutout to {head_path}")
