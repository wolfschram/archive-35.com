"""JPEG compression artifact detection — 8x8 block boundary analysis."""

import os
import cv2
import numpy as np
from ..utils.grading import score_to_grade


COMPRESSION_THRESHOLDS = [(5, 'A'), (15, 'B'), (30, 'C'), (50, 'D')]


def measure_compression(file_path: str) -> dict:
    """Detect JPEG blocking artifacts and gradient banding.

    Analyzes 8x8 block boundaries (JPEG compression block size).
    TIFF files automatically score A (no compression artifacts).
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext in ('.tif', '.tiff'):
        return {
            'artifact_score': 0,
            'banding_detected': False,
            'grade': 'A',
            'note': 'TIFF format — no JPEG compression artifacts',
        }

    img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise IOError(f"Failed to load: {file_path}")

    h, w = img.shape
    img_f = img.astype(np.float64)

    # Measure discontinuity at 8x8 block boundaries vs. within blocks
    # Horizontal block boundaries
    h_boundary_diffs = []
    h_interior_diffs = []

    for y in range(0, h - 1):
        row_diff = float(np.mean(np.abs(img_f[y, :] - img_f[y + 1, :])))
        if (y + 1) % 8 == 0:
            h_boundary_diffs.append(row_diff)
        else:
            h_interior_diffs.append(row_diff)

    # Vertical block boundaries
    v_boundary_diffs = []
    v_interior_diffs = []

    for x in range(0, w - 1):
        col_diff = float(np.mean(np.abs(img_f[:, x] - img_f[:, x + 1])))
        if (x + 1) % 8 == 0:
            v_boundary_diffs.append(col_diff)
        else:
            v_interior_diffs.append(col_diff)

    # Blocking artifact score: ratio of boundary vs interior discontinuity
    avg_boundary = (np.mean(h_boundary_diffs) + np.mean(v_boundary_diffs)) / 2
    avg_interior = (np.mean(h_interior_diffs) + np.mean(v_interior_diffs)) / 2

    if avg_interior > 0:
        artifact_ratio = avg_boundary / avg_interior
        # Score: 1.0 = no artifacts, >1.3 = visible blocking
        artifact_score = max(0, (artifact_ratio - 1.0) * 100)
    else:
        artifact_score = 0

    # Banding detection in smooth gradients
    banding = _detect_banding(img_f)

    return {
        'artifact_score': round(artifact_score, 1),
        'banding_detected': banding,
        'grade': score_to_grade(artifact_score, COMPRESSION_THRESHOLDS, invert=True),
    }


def _detect_banding(img: np.ndarray) -> bool:
    """Detect banding artifacts in smooth gradient areas."""
    h, w = img.shape
    # Sample horizontal strips in sky region (top 30% of image)
    sky_region = img[:int(h * 0.3), :]
    if sky_region.shape[0] < 20:
        return False

    # Check for step-like transitions in smooth areas
    row_diffs = np.diff(sky_region.astype(np.float64), axis=1)
    local_var = np.var(row_diffs, axis=1)
    smooth_rows = local_var < np.percentile(local_var, 20)

    if smooth_rows.sum() < 5:
        return False

    # In smooth rows, check for repeated identical values (banding signature)
    for i in range(min(10, smooth_rows.sum())):
        row_idx = np.where(smooth_rows)[0][i]
        row = sky_region[row_idx, :]
        unique_ratio = len(np.unique(row)) / len(row)
        if unique_ratio < 0.05:  # Very few unique values = banding
            return True

    return False
