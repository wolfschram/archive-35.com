"""Dynamic range analysis — histogram clipping detection for highlights and shadows."""

import cv2
import numpy as np
from ..utils.grading import score_to_grade


def measure_dynamic_range(file_path: str) -> dict:
    """Detect blown highlights and crushed shadows.

    Analyzes histogram extremes (0-5 and 250-255 range).
    """
    img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise IOError(f"Failed to load: {file_path}")

    total_pixels = img.shape[0] * img.shape[1]

    # Highlight clipping: pixels at 255 (pure white)
    highlights_clipped = int(np.sum(img == 255))
    highlights_near = int(np.sum(img >= 250))
    highlights_pct = round(highlights_clipped / total_pixels * 100, 2)

    # Shadow clipping: pixels at 0 (pure black)
    shadows_clipped = int(np.sum(img == 0))
    shadows_near = int(np.sum(img <= 5))
    shadows_pct = round(shadows_clipped / total_pixels * 100, 2)

    # Grade highlights
    if highlights_pct < 0.5:
        h_grade = 'A'
    elif highlights_pct < 2.0:
        h_grade = 'B'
    elif highlights_pct < 5.0:
        h_grade = 'C'
    else:
        h_grade = 'D'

    # Grade shadows
    if shadows_pct < 1.0:
        s_grade = 'A'
    elif shadows_pct < 3.0:
        s_grade = 'B'
    elif shadows_pct < 7.0:
        s_grade = 'C'
    else:
        s_grade = 'D'

    # Overall grade is the worse of the two
    grade_order = {'A': 4, 'B': 3, 'C': 2, 'D': 1, 'F': 0}
    overall_grade = h_grade if grade_order[h_grade] <= grade_order[s_grade] else s_grade

    # Histogram spread (useful for detecting low-contrast images)
    hist = cv2.calcHist([img], [0], None, [256], [0, 256]).flatten()
    hist_nonzero = np.where(hist > 0)[0]
    usable_range = int(hist_nonzero[-1] - hist_nonzero[0]) if len(hist_nonzero) > 1 else 0

    return {
        'highlights_clipped_pct': highlights_pct,
        'highlights_near_pct': round(highlights_near / total_pixels * 100, 2),
        'shadows_clipped_pct': shadows_pct,
        'shadows_near_pct': round(shadows_near / total_pixels * 100, 2),
        'usable_range': usable_range,
        'highlights_grade': h_grade,
        'shadows_grade': s_grade,
        'grade': overall_grade,
    }
