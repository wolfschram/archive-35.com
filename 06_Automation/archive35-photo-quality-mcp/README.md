# Archive-35 Photo Quality Analyzer — MCP Server

Local MCP server for Claude Desktop that analyzes photographs for technical quality and determines maximum sellable print sizes for the Archive-35 fine art photography business.

## What It Does

- **Sharpness analysis** — Laplacian variance with 5x5 zone grid, flags soft areas
- **Noise measurement** — Luminance + chroma SNR in uniform regions (chroma weighted 2x)
- **Dynamic range** — Histogram clipping detection for blown highlights / crushed shadows
- **Compression artifacts** — JPEG 8x8 block boundary analysis, gradient banding detection
- **Print size grading** — DPI calculation for all Pictorem sizes with sharpness-adjusted effective resolution
- **Composite scoring** — Weighted quality score (A/B/C/D/F) across all metrics

## Tools

| Tool | Purpose |
|------|---------|
| `analyze_photo` | Full quality report for a single image |
| `batch_analyze` | Process entire folder, generate catalog CSV |
| `check_print_readiness` | Quick pass/fail for specific print size |
| `compare_versions` | Compare two versions, recommend the better one |

## Requirements

- Python 3.10+
- OpenCV, Pillow, numpy, FastMCP

## Installation

```bash
cd 06_Automation/archive35-photo-quality-mcp
pip install -r requirements.txt
```

## Claude Desktop Config

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "archive35_photo_quality": {
      "command": "python",
      "args": ["-m", "src.server"],
      "cwd": "/path/to/Archive-35.com/06_Automation/archive35-photo-quality-mcp"
    }
  }
}
```

## Quality Weights

| Metric | Weight |
|--------|--------|
| Sharpness | 40% |
| Noise | 20% |
| Dynamic Range | 15% |
| Color Depth | 15% |
| Compression | 10% |

## Print Size Grading

Effective DPI = (pixel dimension x sharpness multiplier) / print dimension

| Grade | DPI | Verdict |
|-------|-----|---------|
| A | 300+ | Gallery quality |
| B | 200-299 | High quality |
| C | 150-199 | Standard (sellable) |
| D | 100-149 | Large wall art only |
| F | <100 | Not recommended |

Minimum sellable threshold: 150 DPI (grade C).

## Pictorem Sizes Evaluated

8x10, 11x14, 12x16, 16x20, 18x24, 20x30, 24x36, 30x40, 36x48, 40x60, 48x72, 60x90

## Project Structure

```
archive35-photo-quality-mcp/
  src/
    server.py           # FastMCP server + 4 tools
    analyzers/
      sharpness.py      # Laplacian variance, zone grid
      noise.py          # Luminance + chroma SNR
      dynamic_range.py  # Histogram clipping
      compression.py    # JPEG blocking + banding
      print_calculator.py # DPI grading per Pictorem sizes
    models/
      schemas.py        # Pydantic input models
    utils/
      grading.py        # Score-to-grade conversion
      image_loader.py   # Image loading, EXIF extraction
  config/
    claude_desktop_config.json
  requirements.txt
  pyproject.toml
```

## Test Results (Web-Optimized Images)

| Collection | Sample | Grade | Score | Max Print |
|------------|--------|-------|-------|-----------|
| Africa | 118A0002-full.jpg | B | 76.3 | 8x10 |
| New Zealand | 118A1369-full.jpg | C | 72.0 | 8x10 |
| Grand Teton | WOLF6535-Pano-full.jpg | C | 74.3 | — |

Note: These are web-optimized images (~2000px). Full-resolution originals from camera will score significantly higher and support larger print sizes.

## Batch Analysis (Africa Collection)

- 88 images scanned
- Grade B: 44 | Grade C: 31 | Grade D: 12 | Grade F: 1
- CSV catalog export supported
