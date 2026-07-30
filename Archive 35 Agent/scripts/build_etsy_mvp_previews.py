#!/usr/bin/env python3
"""Generate three consistent Etsy room previews for each MVP product."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.integrations.mockup_service import generate_social_mockup
from src.products.digital_preview_cards import (
    build_download_cover,
    build_ratio_guide,
)


TEMPLATES = ["living-room-modern", "gallery-dark", "bedroom-standard"]


def main() -> None:
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    results = []
    for product in spec["products"]:
        source = str((AGENT_ROOT / product["source"]).resolve())
        preview_dir = (
            AGENT_ROOT / "data" / "etsy_digital_drafts"
            / product["product_id"] / "previews"
        )
        preview_dir.mkdir(parents=True, exist_ok=True)
        cover = preview_dir / "00-digital-download-cover.jpg"
        ratio_guide = preview_dir / "04-ratio-guide.jpg"
        build_download_cover(source, cover)
        build_ratio_guide(ratio_guide)
        results.extend([str(cover), str(ratio_guide)])
        for template in TEMPLATES:
            output = preview_dir / f"{template}_etsy.jpg"
            if not output.exists():
                output.write_bytes(generate_social_mockup(
                    template_id=template,
                    photo_path=source,
                    platform="etsy",
                    print_size="36x24",
                ))
            results.append(str(output))
    print(json.dumps({"previews": len(results)}, indent=2))


if __name__ == "__main__":
    main()
