"""Archive-35 Photo Quality Analyzer — FastMCP Server.

Analyzes photographs for technical quality and determines maximum
sellable print sizes for the Archive-35 fine art photography business.
"""

import os
import csv
import json
from fastmcp import FastMCP

from .analyzers.sharpness import measure_sharpness
from .analyzers.noise import measure_noise
from .analyzers.dynamic_range import measure_dynamic_range
from .analyzers.compression import measure_compression
from .analyzers.print_calculator import calculate_print_grades
from .utils.image_loader import get_image_info, validate_path, SUPPORTED_EXTENSIONS
from .utils.grading import composite_score, composite_grade


mcp = FastMCP("archive35_photo_quality")

# Weights for composite quality score
QUALITY_WEIGHTS = {
    'sharpness': 0.40,
    'noise': 0.20,
    'dynamic_range': 0.15,
    'compression': 0.10,
    'color_depth': 0.15,
}


def _normalize_sharpness(score: float) -> float:
    """Normalize sharpness score to 0-100 range."""
    return min(100, score / 5.0)


def _normalize_noise(score: float) -> float:
    """Normalize noise score to 0-100 (inverted: lower noise = higher score)."""
    return max(0, min(100, 100 - score * 2))


def _normalize_dynamic_range(result: dict) -> float:
    """Normalize dynamic range to 0-100."""
    grade_scores = {'A': 95, 'B': 80, 'C': 65, 'D': 45, 'F': 20}
    return grade_scores.get(result['grade'], 50)


def _normalize_compression(result: dict) -> float:
    """Normalize compression to 0-100."""
    grade_scores = {'A': 95, 'B': 80, 'C': 65, 'D': 45, 'F': 20}
    return grade_scores.get(result['grade'], 50)


def _color_depth_score(bit_depth: int) -> float:
    """Score based on color depth."""
    return 95 if bit_depth >= 16 else 75


def _full_analysis(file_path: str, target_sizes: list[str] | None = None) -> dict:
    """Run full quality analysis pipeline on a single image."""
    path = validate_path(file_path)
    info = get_image_info(path)

    sharpness = measure_sharpness(path)
    noise = measure_noise(path)
    dynamic_range = measure_dynamic_range(path)
    compression = measure_compression(path)

    # Calculate print grades
    w = info['dimensions']['width']
    h = info['dimensions']['height']
    print_grades, max_sellable = calculate_print_grades(
        w, h, sharpness['overall'], target_sizes
    )

    # Composite score
    normalized = {
        'sharpness': _normalize_sharpness(sharpness['overall']),
        'noise': _normalize_noise(noise['overall']),
        'dynamic_range': _normalize_dynamic_range(dynamic_range),
        'compression': _normalize_compression(compression),
        'color_depth': _color_depth_score(info['format']['bit_depth']),
    }
    overall_score = composite_score(normalized, QUALITY_WEIGHTS)
    overall_grade = composite_grade(overall_score)

    # Build issues list
    issues = []
    if sharpness['soft_zones']:
        for sz in sharpness['soft_zones'][:3]:
            issues.append(f"Soft zone at {sz['note']} (score {sz['score']})")
    if noise['overall'] > 15:
        issues.append(f"Elevated noise ({noise['overall']:.0f}) — may be visible in large prints")
    if dynamic_range['highlights_clipped_pct'] > 2:
        issues.append(f"Blown highlights ({dynamic_range['highlights_clipped_pct']:.1f}% clipped)")
    if dynamic_range['shadows_clipped_pct'] > 3:
        issues.append(f"Crushed shadows ({dynamic_range['shadows_clipped_pct']:.1f}% clipped)")
    if compression.get('banding_detected'):
        issues.append("Gradient banding detected — may be visible in sky/water areas")

    # Recommendation
    if max_sellable:
        rec = f"Sellable up to {max_sellable}."
        # Find next size down that's grade A or B
        for size, data in reversed(list(print_grades.items())):
            if data['grade'] in ('A', 'B'):
                rec += f" Excellent quality at {size} and below."
                break
    else:
        rec = "Not recommended for fine art printing at any evaluated size."

    return {
        **info,
        'quality_scores': {
            'sharpness': sharpness,
            'noise': noise,
            'dynamic_range': dynamic_range,
            'compression': compression,
            'overall_grade': overall_grade,
            'overall_score': overall_score,
        },
        'print_sizes': print_grades,
        'max_sellable_size': max_sellable,
        'issues': issues,
        'recommendation': rec,
    }


@mcp.tool()
def analyze_photo(file_path: str, target_sizes: list[str] | None = None, dpi_threshold: int = 200) -> str:
    """Analyze a single image and return a detailed quality report.

    Measures sharpness, noise, dynamic range, compression artifacts,
    and calculates maximum sellable print sizes for Pictorem fulfillment.

    Args:
        file_path: Absolute path to JPEG or TIFF file
        target_sizes: Print sizes to evaluate (e.g., ["8x10", "24x36", "40x60"])
        dpi_threshold: Minimum DPI for 'sellable' verdict (150-300)
    """
    try:
        result = _full_analysis(file_path, target_sizes)
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return json.dumps({'error': str(e)})


def _batch_analyze(
    folder_path: str,
    recursive: bool = True,
    min_grade: str = "C",
    target_size: str = "24x36",
    output_csv: str | None = None,
) -> dict:
    """Internal batch analysis logic — returns dict (not JSON string)."""
    folder = os.path.abspath(folder_path)
    if not os.path.isdir(folder):
        raise NotADirectoryError(f'Not a directory: {folder}')

    # Collect image files
    image_files = []
    if recursive:
        for root, _, files in os.walk(folder):
            for f in files:
                if os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS:
                    image_files.append(os.path.join(root, f))
    else:
        for f in os.listdir(folder):
            if os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS:
                image_files.append(os.path.join(folder, f))

    image_files.sort()
    grade_order = {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1}
    min_grade_val = grade_order.get(min_grade.upper(), 3)

    results = []
    errors = []

    for img_path in image_files:
        try:
            analysis = _full_analysis(img_path, [target_size])
            grade = analysis['quality_scores']['overall_grade']
            if grade_order.get(grade, 0) >= min_grade_val:
                results.append({
                    'file': os.path.basename(img_path),
                    'path': img_path,
                    'dimensions': f"{analysis['dimensions']['width']}x{analysis['dimensions']['height']}",
                    'megapixels': analysis['dimensions']['megapixels'],
                    'overall_grade': grade,
                    'overall_score': analysis['quality_scores']['overall_score'],
                    'sharpness': analysis['quality_scores']['sharpness']['overall'],
                    'noise': analysis['quality_scores']['noise']['overall'],
                    'max_sellable': analysis.get('max_sellable_size', 'N/A'),
                    'target_grade': analysis['print_sizes'].get(target_size, {}).get('grade', 'N/A'),
                    'issues': '; '.join(analysis.get('issues', [])),
                })
        except Exception as e:
            errors.append({'file': os.path.basename(img_path), 'error': str(e)})

    # Save CSV if requested
    if output_csv and results:
        csv_path = os.path.abspath(output_csv)
        with open(csv_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=results[0].keys())
            writer.writeheader()
            writer.writerows(results)

    summary = {
        'folder': folder,
        'total_scanned': len(image_files),
        'passed_filter': len(results),
        'errors': len(errors),
        'grade_distribution': {},
    }
    for r in results:
        g = r['overall_grade']
        summary['grade_distribution'][g] = summary['grade_distribution'].get(g, 0) + 1

    return {
        'summary': summary,
        'results': results[:50],
        'errors': errors[:10],
        'csv_saved': output_csv if output_csv and results else None,
    }


@mcp.tool()
def batch_analyze(
    folder_path: str,
    recursive: bool = True,
    min_grade: str = "C",
    target_size: str = "24x36",
    output_csv: str | None = None,
) -> str:
    """Process an entire folder and generate a catalog quality report.

    Args:
        folder_path: Path to folder containing images
        recursive: Include subfolders
        min_grade: Minimum grade to include in results (A/B/C/D/F)
        target_size: Target print size to evaluate against
        output_csv: Optional path to save CSV catalog report
    """
    try:
        result = _batch_analyze(folder_path, recursive, min_grade, target_size, output_csv)
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return json.dumps({'error': str(e)})


def _check_print_readiness(
    file_path: str,
    print_width: float,
    print_height: float,
    quality_level: str = "high",
) -> dict:
    """Internal print readiness check — returns dict."""
    path = validate_path(file_path)
    info = get_image_info(path)
    sharpness = measure_sharpness(path)

    dpi_map = {'gallery': 300, 'high': 200, 'standard': 150}
    required_dpi = dpi_map.get(quality_level, 200)

    w = info['dimensions']['width']
    h = info['dimensions']['height']
    multiplier = min(1.0, sharpness['overall'] / 300)

    eff_w = w * multiplier
    eff_h = h * multiplier

    # Try both orientations
    dpi1 = min(eff_w / print_width, eff_h / print_height)
    dpi2 = min(eff_w / print_height, eff_h / print_width)
    actual_dpi = max(dpi1, dpi2)

    verdict = "PASS" if actual_dpi >= required_dpi else "FAIL"

    max_w = eff_w / required_dpi
    max_h = eff_h / required_dpi

    result = {
        'file': path,
        'requested_size': f'{print_width}x{print_height}',
        'quality_level': quality_level,
        'required_dpi': required_dpi,
        'actual_dpi': round(actual_dpi),
        'verdict': verdict,
        'sharpness_score': sharpness['overall'],
        'sharpness_multiplier': round(multiplier, 2),
    }

    if verdict == 'FAIL':
        result['reason'] = f"Image resolves to {round(actual_dpi)} DPI at {print_width}x{print_height}, below {required_dpi} DPI threshold"
        result['suggestion'] = f"Maximum size at '{quality_level}' quality: {round(max_w)}x{round(max_h)}"
    else:
        result['reason'] = f"Image resolves to {round(actual_dpi)} DPI — meets {quality_level} quality threshold"

    return result


@mcp.tool()
def check_print_readiness(
    file_path: str,
    print_width: float,
    print_height: float,
    quality_level: str = "high",
) -> str:
    """Quick check: can this image be printed at a specific size?

    Args:
        file_path: Absolute path to image file
        print_width: Print width in inches
        print_height: Print height in inches
        quality_level: 'gallery' (300dpi), 'high' (200dpi), 'standard' (150dpi)
    """
    try:
        result = _check_print_readiness(file_path, print_width, print_height, quality_level)
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return json.dumps({'error': str(e)})


def _compare_versions(file_a: str, file_b: str) -> dict:
    """Internal version comparison — returns dict."""
    analysis_a = _full_analysis(file_a)
    analysis_b = _full_analysis(file_b)

    def extract_summary(analysis, label):
        qs = analysis['quality_scores']
        return {
            'label': label,
            'file': os.path.basename(analysis['file']),
            'dimensions': f"{analysis['dimensions']['width']}x{analysis['dimensions']['height']}",
            'megapixels': analysis['dimensions']['megapixels'],
            'overall_grade': qs['overall_grade'],
            'overall_score': qs['overall_score'],
            'sharpness': qs['sharpness']['overall'],
            'noise': qs['noise']['overall'],
            'dynamic_range_grade': qs['dynamic_range']['grade'],
            'compression_grade': qs['compression']['grade'],
            'max_sellable': analysis.get('max_sellable_size', 'N/A'),
            'issues': analysis.get('issues', []),
        }

    sum_a = extract_summary(analysis_a, 'A')
    sum_b = extract_summary(analysis_b, 'B')

    score_a = analysis_a['quality_scores']['overall_score']
    score_b = analysis_b['quality_scores']['overall_score']

    if score_a > score_b:
        winner = 'A'
        reason = f"Version A scores {score_a} vs B's {score_b}"
    elif score_b > score_a:
        winner = 'B'
        reason = f"Version B scores {score_b} vs A's {score_a}"
    else:
        winner = 'TIE'
        reason = f"Both score {score_a} — check individual metrics"

    return {
        'version_a': sum_a,
        'version_b': sum_b,
        'winner': winner,
        'reason': reason,
        'recommendation': f"Use version {winner} for print selling." if winner != 'TIE' else "Both versions are equivalent — choose based on artistic preference.",
    }


@mcp.tool()
def compare_versions(file_a: str, file_b: str) -> str:
    """Compare two versions of the same image and recommend the better one.

    Useful for comparing different export settings, crops, or edits.

    Args:
        file_a: Path to first image
        file_b: Path to second image
    """
    try:
        result = _compare_versions(file_a, file_b)
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return json.dumps({'error': str(e)})


def main():
    mcp.run()


if __name__ == "__main__":
    main()
