"""Sharpness analysis via Laplacian variance — global + 5x5 zone grid."""

import cv2
import numpy as np
from ..utils.grading import score_to_grade


SHARPNESS_THRESHOLDS = [(500, 'A'), (200, 'B'), (100, 'C'), (50, 'D')]


def measure_sharpness(file_path: str) -> dict:
    """Analyze image sharpness using Laplacian variance.

    Returns overall score, 5x5 zone map, and soft zone flags.
    """
    img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise IOError(f"Failed to load: {file_path}")

    # Global sharpness
    laplacian = cv2.Laplacian(img, cv2.CV_64F)
    global_score = float(laplacian.var())

    # Zone-based sharpness (5x5 grid)
    h, w = img.shape
    zone_h, zone_w = h // 5, w // 5
    zone_scores = []
    soft_zones = []

    for row in range(5):
        row_scores = []
        for col in range(5):
            y1, y2 = row * zone_h, (row + 1) * zone_h
            x1, x2 = col * zone_w, (col + 1) * zone_w
            zone = img[y1:y2, x1:x2]
            lap = cv2.Laplacian(zone, cv2.CV_64F)
            score = float(lap.var())
            row_scores.append(round(score, 1))

            if global_score > 0 and score < global_score * 0.6:
                soft_zones.append({
                    'zone': [row, col],
                    'score': round(score, 1),
                    'relative': round(score / global_score, 2) if global_score > 0 else 0,
                    'note': _zone_description(row, col),
                })
        zone_scores.append(row_scores)

    return {
        'overall': round(global_score, 1),
        'zone_map': zone_scores,
        'soft_zones': soft_zones,
        'grade': score_to_grade(global_score, SHARPNESS_THRESHOLDS),
    }


def _zone_description(row: int, col: int) -> str:
    """Human-readable description of a zone position."""
    v = ['top', 'upper', 'center', 'lower', 'bottom'][row]
    h = ['left', 'center-left', 'center', 'center-right', 'right'][col]
    return f"soft {v}-{h}"
