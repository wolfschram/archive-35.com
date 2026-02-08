"""Score-to-grade conversion utilities."""


def score_to_grade(score: float, thresholds: list[tuple[float, str]], invert: bool = False) -> str:
    """Convert numeric score to letter grade.

    Args:
        score: Numeric score to grade
        thresholds: List of (threshold, grade) pairs, sorted high-to-low
        invert: If True, lower scores are better (e.g., noise)
    """
    if invert:
        for threshold, grade in thresholds:
            if score <= threshold:
                return grade
        return 'F'
    else:
        for threshold, grade in thresholds:
            if score >= threshold:
                return grade
        return 'F'


def composite_score(scores: dict[str, float], weights: dict[str, float]) -> float:
    """Calculate weighted composite score.

    Args:
        scores: Dict of metric_name -> normalized score (0-100)
        weights: Dict of metric_name -> weight (should sum to 1.0)
    """
    total = 0.0
    for metric, weight in weights.items():
        total += scores.get(metric, 0) * weight
    return round(total, 1)


def composite_grade(score: float) -> str:
    """Convert composite score (0-100) to letter grade."""
    if score >= 90:
        return 'A'
    elif score >= 75:
        return 'B'
    elif score >= 60:
        return 'C'
    elif score >= 40:
        return 'D'
    return 'F'
