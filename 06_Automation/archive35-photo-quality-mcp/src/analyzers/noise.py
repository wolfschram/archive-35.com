"""Noise analysis — luminance + chroma SNR measurement in uniform regions."""

import cv2
import numpy as np
from ..utils.grading import score_to_grade


NOISE_THRESHOLDS = [(5, 'A'), (15, 'B'), (30, 'C'), (50, 'D')]


def measure_noise(file_path: str) -> dict:
    """Measure noise in uniform regions (sky, walls, water).

    Chroma noise weighted 2x (more objectionable in prints).
    """
    img = cv2.imread(file_path)
    if img is None:
        raise IOError(f"Failed to load: {file_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float64)

    # Find uniform regions via local variance thresholding
    blurred = cv2.blur(gray, (7, 7))
    local_var = cv2.blur((gray - blurred) ** 2, (15, 15))
    threshold = np.percentile(local_var, 20)
    uniform_mask = local_var < threshold

    min_pixels = 1000
    if uniform_mask.sum() > min_pixels:
        noise_region = gray[uniform_mask]
        lum_noise = float(noise_region.std())
    else:
        # Fallback: median absolute deviation of Laplacian
        lap = cv2.Laplacian(gray, cv2.CV_64F)
        sigma = float(np.median(np.abs(lap)) / 0.6745)
        lum_noise = sigma

    # Chroma noise in LAB color space
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float64)
    if uniform_mask.sum() > min_pixels:
        a_noise = float(lab[:, :, 1][uniform_mask].std())
        b_noise = float(lab[:, :, 2][uniform_mask].std())
    else:
        a_noise = 0.0
        b_noise = 0.0

    chroma_noise = (a_noise + b_noise) / 2
    overall = lum_noise + chroma_noise * 2  # Chroma weighted 2x

    return {
        'luminance': round(lum_noise, 1),
        'chroma': round(chroma_noise, 1),
        'overall': round(overall, 1),
        'grade': score_to_grade(overall, NOISE_THRESHOLDS, invert=True),
    }
