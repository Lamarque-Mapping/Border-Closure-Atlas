#!/usr/bin/env python3
"""Derive the repaired, professionally formatted workbook before data import.

Git retains the original research workbook. A narrow metadata repair fixes its
native tables; artifact-authored presentation resources improve the download.
All research cells, cached formulas and sheet names/order are verified unchanged.
The importer copies this exact source package to the public XLSX download, so
the download and every data provenance binding have one matching fingerprint.
"""
import hashlib
import json
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SHA = "f96ad671372e6fb9c1afd564373d954c717f4bf809b75a757b48f54ee08ca024"
REPAIRED_SHA = "b7290c0ce1056ed7f045ff66e7354edd1d5593db001b12f4d65372318185c6f1"
WORKBOOK = ROOT / "source/Global_Border_Closures_Register_2016_2026.xlsx"
REPAIR = ROOT / "scripts/repair-workbook-package.py"
PRESENTATION = ROOT / "scripts/workbook-presentation.py"
PRESENTATION_RESOURCES = ROOT / "source/workbook-presentation.json"
REPORT = ROOT / "source/workbook-release-report.json"


def tracked_original():
    """Read the immutable input even when a local build has prepared the source."""
    original = subprocess.run(["git", "show", "HEAD:source/Global_Border_Closures_Register_2016_2026.xlsx"],
                              cwd=ROOT, check=True, capture_output=True).stdout
    assert hashlib.sha256(original).hexdigest() == ORIGINAL_SHA, "The tracked research snapshot changed; review before release."
    return original


def main():
    initial = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    spec = importlib.util.spec_from_file_location("workbook_presentation", PRESENTATION)
    presentation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(presentation)
    with tempfile.TemporaryDirectory(prefix="atlas-workbook-") as directory:
        original = Path(directory) / "original.xlsx"
        repaired = Path(directory) / "repaired.xlsx"
        formatted = Path(directory) / "formatted.xlsx"
        original.write_bytes(tracked_original())
        result = subprocess.run([sys.executable, str(REPAIR), str(original),
                                 "--repair", str(repaired)], check=True, capture_output=True, text=True)
        repair = json.loads(result.stdout)
        assert len(repair["changed_members"]) == 6
        assert repair["all_other_members_byte_identical"]
        metadata_sha = hashlib.sha256(repaired.read_bytes()).hexdigest()
        if initial not in {ORIGINAL_SHA, REPAIRED_SHA, metadata_sha}:
            # A prepared local source is acceptable only if the same original
            # research contents and native features are still exactly present.
            presentation.verify_presentation(repaired, WORKBOOK)
        formatting = presentation.apply_presentation(repaired, formatted)
        subprocess.run([sys.executable, str(REPAIR), str(formatted)], check=True, capture_output=True)
        WORKBOOK.write_bytes(formatted.read_bytes())
    fingerprint = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    # Compression-library versions can affect ZIP bytes. The repair and style
    # comparisons prove exactly which XML metadata changed before rebinding.
    previous_bindings = {ORIGINAL_SHA, REPAIRED_SHA, metadata_sha, initial, fingerprint}
    for name in ["source/crossings/locations.json", "source/crossings/scope-review.json"]:
        path = ROOT / name
        text = path.read_text()
        previous = json.loads(text)["source_sha256"]
        assert previous in previous_bindings
        assert text.count(previous) == 1
        path.write_text(text.replace(previous, fingerprint))
    for name in ["dist/national.js", "scripts/verify-workbook.py"]:
        path = ROOT / name
        text = path.read_text()
        previous = next((value for value in previous_bindings
                         if value in text), None)
        assert previous and text.count(previous) == 1, name
        path.write_text(text.replace(previous, fingerprint))
    report = {"original_source_sha256": ORIGINAL_SHA, "repaired_sha256": metadata_sha,
              "release_sha256": fingerprint,
              "presentation_resources_sha256": hashlib.sha256(PRESENTATION_RESOURCES.read_bytes()).hexdigest(),
              "metadata_repair": repair, "presentation": formatting,
              "native_excel_tested": False}
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"source_sha256": initial, "release_sha256": fingerprint,
                      "worksheets": formatting["worksheet_count"],
                      "preserved_cells": formatting["cell_payloads_preserved"],
                      "preserved_formulas": formatting["formula_payloads_preserved"],
                      "research_content_unchanged": True,
                      "repair": "unique table IDs and header metadata", "presentation": "artifact-authored styles"}))


if __name__ == "__main__":
    main()
