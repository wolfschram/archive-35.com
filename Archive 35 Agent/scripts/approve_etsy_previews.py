#!/usr/bin/env python3
"""Approve an explicit set of visually inspected Etsy preview files."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.products.preview_approval import approve_previews


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir")
    parser.add_argument("filenames", nargs="+")
    args = parser.parse_args()
    destination = approve_previews(args.package_dir, args.filenames)
    print(destination)


if __name__ == "__main__":
    main()
