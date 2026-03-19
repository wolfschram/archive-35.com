#!/usr/bin/env python3
"""
Embed copyright/credit metadata into licensed JPG images.
Uses piexif for EXIF fields + writes XMP sidecar files for full IPTC/XMP coverage.
"""
import os
import sys
import glob
import piexif
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

COPYRIGHT = "\u00a9 2026 Wolf Schram / Archive-35. All rights reserved."
CREATOR = "Wolf Schram"
CREDIT = "Archive-35 / The Restless Eye"
SOURCE = "archive-35.com"
RIGHTS = "Licensed image. Terms at https://archive-35.com/terms.html"

DIRS = [
    ROOT / "09_Licensing" / "watermarked",
    ROOT / "09_Licensing" / "micro",
]

XMP_TEMPLATE = """<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">
      <dc:creator>
        <rdf:Seq><rdf:li>{creator}</rdf:li></rdf:Seq>
      </dc:creator>
      <dc:rights>
        <rdf:Alt><rdf:li xml:lang="x-default">{copyright}</rdf:li></rdf:Alt>
      </dc:rights>
      <photoshop:Credit>{credit}</photoshop:Credit>
      <photoshop:Source>{source}</photoshop:Source>
      <xmpRights:UsageTerms>
        <rdf:Alt><rdf:li xml:lang="x-default">{rights}</rdf:li></rdf:Alt>
      </xmpRights:UsageTerms>
      <xmpRights:WebStatement>https://archive-35.com/terms.html</xmpRights:WebStatement>
      <xmpRights:Marked>True</xmpRights:Marked>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def embed_exif(filepath):
    """Embed copyright info into EXIF data using piexif."""
    try:
        exif_dict = piexif.load(str(filepath))
    except Exception:
        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}

    # EXIF 0th IFD fields
    exif_dict["0th"][piexif.ImageIFD.Copyright] = COPYRIGHT.encode("utf-8")
    exif_dict["0th"][piexif.ImageIFD.Artist] = CREATOR.encode("utf-8")

    try:
        exif_bytes = piexif.dump(exif_dict)
        piexif.insert(exif_bytes, str(filepath))
        return True
    except Exception as e:
        print(f"  WARN: EXIF embed failed for {filepath.name}: {e}")
        return False


def write_xmp_sidecar(filepath):
    """Write an XMP sidecar file next to the image."""
    xmp_path = filepath.with_suffix(".xmp")
    xmp_content = XMP_TEMPLATE.format(
        creator=CREATOR,
        copyright=COPYRIGHT,
        credit=CREDIT,
        source=SOURCE,
        rights=RIGHTS,
    )
    xmp_path.write_text(xmp_content, encoding="utf-8")
    return True


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0  # 0 = all
    total_exif = 0
    total_xmp = 0
    total_files = 0
    errors = 0

    for d in DIRS:
        if not d.exists():
            print(f"SKIP: {d} does not exist")
            continue

        jpgs = sorted(d.glob("*.jpg"))
        if limit:
            jpgs = jpgs[:limit]

        print(f"\nProcessing {len(jpgs)} images in {d.name}/")

        for jpg in jpgs:
            total_files += 1
            ok_exif = embed_exif(jpg)
            ok_xmp = write_xmp_sidecar(jpg)

            if ok_exif:
                total_exif += 1
            if ok_xmp:
                total_xmp += 1
            if not ok_exif and not ok_xmp:
                errors += 1

    print(f"\n--- Summary ---")
    print(f"Files processed: {total_files}")
    print(f"EXIF embedded:   {total_exif}")
    print(f"XMP sidecars:    {total_xmp}")
    if errors:
        print(f"Errors:          {errors}")


if __name__ == "__main__":
    main()
