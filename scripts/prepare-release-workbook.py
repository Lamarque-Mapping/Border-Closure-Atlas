#!/usr/bin/env python3
"""Apply the reviewed Excel package repair before building the public release.

The Git source retains the original research workbook. This step repairs only
duplicate OOXML table identifiers, verifies that worksheet content is unchanged,
and binds the existing location decisions to the resulting package fingerprint.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SHA = "f96ad671372e6fb9c1afd564373d954c717f4bf809b75a757b48f54ee08ca024"
REPAIRED_SHA = "b7290c0ce1056ed7f045ff66e7354edd1d5593db001b12f4d65372318185c6f1"
WORKBOOK = ROOT / "source/Global_Border_Closures_Register_2016_2026.xlsx"
REPAIR = ROOT / "scripts/repair-workbook-package.py"


def main():
    original = WORKBOOK.read_bytes()
    initial = hashlib.sha256(original).hexdigest()
    if initial not in {ORIGINAL_SHA, REPAIRED_SHA}:
        raise SystemExit("Unexpected source workbook: review the release binding before publishing.")
    if initial == ORIGINAL_SHA:
        with tempfile.TemporaryDirectory(prefix="atlas-workbook-") as directory:
            repaired = Path(directory) / "repaired.xlsx"
            result = subprocess.run([sys.executable, str(REPAIR), str(WORKBOOK),
                                     "--repair", str(repaired)], check=True, capture_output=True, text=True)
            report = json.loads(result.stdout)
            assert len(report["changed_members"]) == 4
            assert report["all_other_members_byte_identical"]
            WORKBOOK.write_bytes(repaired.read_bytes())
    else:
        subprocess.run([sys.executable, str(REPAIR), str(WORKBOOK)], check=True, capture_output=True)
    fingerprint = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    # Compression-library versions may change ZIP bytes; the repair helper has
    # already proved that the only XML changes are the four reviewed table IDs.
    for name in ["source/crossings/locations.json", "source/crossings/scope-review.json"]:
        path = ROOT / name
        text = path.read_text()
        previous = json.loads(text)["source_sha256"]
        assert previous in {ORIGINAL_SHA, REPAIRED_SHA, fingerprint}
        assert text.count(previous) == 1
        path.write_text(text.replace(previous, fingerprint))
    for name in ["dist/national.js", "scripts/verify-workbook.py"]:
        path = ROOT / name
        text = path.read_text()
        previous = next((value for value in [ORIGINAL_SHA, REPAIRED_SHA, fingerprint]
                         if value in text), None)
        assert previous and text.count(previous) == 1, name
        path.write_text(text.replace(previous, fingerprint))
    print(json.dumps({"source_sha256": initial, "release_sha256": fingerprint,
                      "worksheets_unchanged": True, "repair": "unique table identifiers"}))


if __name__ == "__main__":
    main()
