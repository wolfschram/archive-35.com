"""Print size calculator — DPI grading per Pictorem sizes with sharpness adjustment."""


PICTOREM_SIZES = [
    (8, 10), (11, 14), (12, 16), (16, 20),
    (18, 24), (20, 30), (24, 36), (30, 40),
    (36, 48), (40, 60), (48, 72), (60, 90),
]

DPI_THRESHOLDS = {
    'gallery': 300,   # Critical viewing distance
    'high': 200,      # Normal home viewing
    'standard': 150,  # Large wall art, 3+ feet
    'minimum': 100,   # Very large, far viewing
}


def calculate_print_grades(
    width_px: int,
    height_px: int,
    sharpness_score: float,
    target_sizes: list[str] | None = None,
) -> tuple[dict, str | None]:
    """Calculate print quality grades for each Pictorem size.

    Args:
        width_px: Image width in pixels
        height_px: Image height in pixels
        sharpness_score: Laplacian variance sharpness score
        target_sizes: Optional list of sizes to evaluate (e.g., ["8x10", "24x36"])

    Returns:
        Tuple of (size_grades_dict, max_sellable_size)
    """
    # Adjust effective resolution for sharpness
    multiplier = min(1.0, sharpness_score / 300) if sharpness_score > 0 else 0
    eff_w = width_px * multiplier
    eff_h = height_px * multiplier

    # Parse target sizes filter
    if target_sizes:
        filter_set = set(target_sizes)
    else:
        filter_set = None

    results = {}
    max_sellable = None

    for pw, ph in PICTOREM_SIZES:
        size_key = f'{pw}x{ph}'

        if filter_set and size_key not in filter_set:
            continue

        # Use longest edge for DPI calc (image may be landscape or portrait)
        # Try both orientations
        dpi_option1 = min(eff_w / pw, eff_h / ph)
        dpi_option2 = min(eff_w / ph, eff_h / pw)
        effective_dpi = max(dpi_option1, dpi_option2)

        if effective_dpi >= 300:
            grade = 'A'
        elif effective_dpi >= 200:
            grade = 'B'
        elif effective_dpi >= 150:
            grade = 'C'
        elif effective_dpi >= 100:
            grade = 'D'
        else:
            grade = 'F'

        sellable = effective_dpi >= 150  # Standard threshold

        results[size_key] = {
            'dpi': round(effective_dpi),
            'grade': grade,
            'sellable': sellable,
        }

        if sellable:
            max_sellable = size_key

    return results, max_sellable
