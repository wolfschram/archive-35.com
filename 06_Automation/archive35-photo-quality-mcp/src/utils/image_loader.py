"""Image loading and EXIF extraction utilities."""

import os
import cv2
import numpy as np
from PIL import Image
from PIL.ExifTags import TAGS


SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.tif', '.tiff'}


def validate_path(file_path: str) -> str:
    """Validate image path and return absolute path."""
    path = os.path.abspath(file_path)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Image not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported format: {ext}. Supported: {SUPPORTED_EXTENSIONS}")
    return path


def load_image_cv(file_path: str) -> np.ndarray:
    """Load image with OpenCV (BGR)."""
    img = cv2.imread(file_path, cv2.IMREAD_COLOR)
    if img is None:
        raise IOError(f"Failed to load image: {file_path}")
    return img


def load_image_gray(file_path: str) -> np.ndarray:
    """Load image as grayscale."""
    img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise IOError(f"Failed to load image: {file_path}")
    return img


def get_image_info(file_path: str) -> dict:
    """Extract dimensions, format, and EXIF metadata."""
    path = validate_path(file_path)

    with Image.open(path) as img:
        width, height = img.size
        fmt = img.format or os.path.splitext(path)[1].upper().strip('.')
        mode = img.mode
        bit_depth = 8 if mode in ('L', 'RGB', 'RGBA') else 16 if mode == 'I;16' else 8

        exif_data = {}
        try:
            raw_exif = img._getexif()
            if raw_exif:
                for tag_id, value in raw_exif.items():
                    tag = TAGS.get(tag_id, tag_id)
                    if isinstance(tag, str) and isinstance(value, (str, int, float)):
                        exif_data[tag] = value
        except (AttributeError, Exception):
            pass

    file_size = os.path.getsize(path)
    megapixels = round((width * height) / 1_000_000, 1)

    return {
        'file': path,
        'file_size_mb': round(file_size / (1024 * 1024), 1),
        'dimensions': {
            'width': width,
            'height': height,
            'megapixels': megapixels,
            'aspect_ratio': round(width / height, 2) if height > 0 else 0,
        },
        'format': {
            'type': fmt.upper(),
            'bit_depth': bit_depth,
            'color_space': mode,
        },
        'exif': {
            'camera': exif_data.get('Model', 'Unknown'),
            'lens': exif_data.get('LensModel', 'Unknown'),
            'iso': exif_data.get('ISOSpeedRatings', None),
            'aperture': exif_data.get('FNumber', None),
            'shutter_speed': exif_data.get('ExposureTime', None),
            'focal_length': exif_data.get('FocalLength', None),
        }
    }
