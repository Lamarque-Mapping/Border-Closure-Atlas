#!/usr/bin/env python3
"""Validate the current two-tab reader's package without resaving it.

The current release has one native table with 18 headers. Explicit historical
workbook arguments retain the old55-table metadata regressions. Independent
OOXML fixtures exercise structural defects for either input contract.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr
from release_common import READER_PATH,MODEL_PATH,load_json,read_manifest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("workbook_package", Path(__file__).with_name("repair-workbook-package.py"))
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
MAIN, REL, DOC_REL = PACKAGE.MAIN, PACKAGE.REL, PACKAGE.DOC_REL
ORIGINAL_SHA = "f96ad671372e6fb9c1afd564373d954c717f4bf809b75a757b48f54ee08ca024"
PREVIOUS_SHA = "b7290c0ce1056ed7f045ff66e7354edd1d5593db001b12f4d65372318185c6f1"
HEADER_FIXES = [
    ("xl/tables/table4.xml", "C1", "Evidence assessment", "Historical parent-claim assessment"),
    ("xl/tables/table4.xml", "F1", "Assessment note",
     "Historical note — current findings are in Audit review and Follow-up review"),
    ("xl/tables/table10.xml", "I1", "Execution time", "Execution time (UTC)"),
]
ID_FIXES = [(57, 57, 70), (59, 59, 71), (60, 60, 72), (62, 62, 73)]


def rejected(action, expected_message):
    try:
        action()
    except AssertionError as error:
        assert expected_message in str(error), f"Wrong rejection: {error}"
    else:
        raise AssertionError(f"Invalid package accepted: {expected_message}")


def alter(contents, part, path, attribute, value):
    result = dict(contents)
    root = ET.fromstring(result[part])
    node = root if path is None else root.find(path)
    assert node is not None
    node.set(attribute, value)
    result[part] = ET.tostring(root, encoding="utf-8")
    return result


def fixture():
    special = 'Cost "net" & gross > zero\nOwner\'s note'
    table1 = f"""<x:table xmlns:x="{MAIN}" id="1" name="AlphaTable" displayName="AlphaTable" ref="A1:B2" headerRowCount="1">
<x:autoFilter ref="A1:B2"/><x:tableColumns count="2">
<x:tableColumn id="1" name="Alpha"/><x:tableColumn id="2" name={quoteattr(special)}/>
</x:tableColumns><x:tableStyleInfo name="TableStyleMedium2"/></x:table>"""
    table2 = f"""<table xmlns="{MAIN}" id='2' name='BetaTable' displayName='BetaTable' ref='D1:E2' headerRowCount='1'>
<tableColumns count='2'><tableColumn id='1' name='Shared header'/><tableColumn id='2' name='Plain header'/></tableColumns></table>"""
    parts = {
        "_rels/.rels": f'<Relationships xmlns="{REL}"><Relationship Id="workbook" Type="{DOC_REL}/officeDocument" Target="/xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{MAIN}" xmlns:r="{DOC_REL}"><sheets><sheet name="Regression" sheetId="1" r:id="sheet"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{REL}"><Relationship Id="sheet" Type="{DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="strings" Type="{DOC_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
        "xl/sharedStrings.xml": f'<sst xmlns="{MAIN}" count="1" uniqueCount="1"><si><r><t xml:space="preserve">Shared </t></r><r><t>header</t></r></si></sst>',
        "xl/worksheets/sheet1.xml": f"""<worksheet xmlns="{MAIN}" xmlns:r="{DOC_REL}"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Alpha</t></is></c><c r="B1" t="inlineStr"><is><t xml:space="preserve">{escape(special)}</t></is></c>
<c r="D1" t="s"><v>0</v></c><c r="E1" t="str"><v>Plain header</v></c></row>
<row r="2"><c r="A2"><v>7</v></c><c r="D2"><v>9</v></c></row></sheetData>
<tableParts count="2"><tablePart r:id="table1"/><tablePart r:id="table2"/></tableParts></worksheet>""",
        "xl/worksheets/_rels/sheet1.xml.rels": f'<Relationships xmlns="{REL}"><Relationship Id="table1" Type="{DOC_REL}/table" Target="../tables/table1.xml"/><Relationship Id="table2" Type="{DOC_REL}/table" Target="/xl/tables/table2.xml"/></Relationships>',
        "xl/tables/table1.xml": table1,
        "xl/tables/table2.xml": table2,
        "docProps/custom.xml": "<properties><note>Must remain byte-identical.</note></properties>",
    }
    return {name: value.encode("utf-8") for name, value in parts.items()}, special


def structural_regressions():
    good, special = fixture()
    report, _ = PACKAGE.inspect(good)
    assert report["tables"] == 2 and report["table_headers_checked"] == 4
    unchanged, repairs = PACKAGE.repair_contents(good)
    assert unchanged == good and not repairs, "Valid packages must be left untouched"
    table1, table2 = "xl/tables/table1.xml", "xl/tables/table2.xml"
    columns = f"{{{MAIN}}}tableColumns"
    column2 = columns + f"/{{{MAIN}}}tableColumn[@id='2']"
    cases = [
        (table1, None, "ref", "A1:C2", "Table width"),
        (table1, None, "ref", "XFE1:XFF2", "outside worksheet bounds"),
        (table1, None, "ref", "B2:A1", "Reversed table/filter range"),
        (table1, f"{{{MAIN}}}autoFilter", "ref", "A1:B1", "AutoFilter range"),
        (table1, columns, "count", "3", "Column count"),
        (table1, column2, "id", "1", "Duplicate column IDs"),
        (table1, column2, "name", "ALPHA", "Duplicate column names"),
        (table1, None, "headerRowCount", "2", "Invalid header/totals row count"),
        (table2, None, "name", "alphatable", "Duplicate table name"),
        (table2, None, "displayName", "ALPHATABLE", "Duplicate table displayName"),
        ("xl/worksheets/sheet1.xml", f"{{{MAIN}}}tableParts", "count", "1", "TableParts count"),
        ("xl/worksheets/sheet1.xml", f"{{{MAIN}}}tableParts/{{{MAIN}}}tablePart", f"{{{DOC_REL}}}id", "absent", "Missing table relationship"),
        ("xl/worksheets/_rels/sheet1.xml.rels", f"{{{REL}}}Relationship[@Id='table1']", "Target", "../tables/missing.xml", "Missing relationship target"),
        ("xl/worksheets/_rels/sheet1.xml.rels", f"{{{REL}}}Relationship[@Id='table2']", "Target", "../tables/table1.xml", "Table referenced more than once"),
        ("xl/worksheets/_rels/sheet1.xml.rels", f"{{{REL}}}Relationship[@Id='table2']", "Id", "table1", "Duplicate relationships"),
        ("xl/worksheets/_rels/sheet1.xml.rels", f"{{{REL}}}Relationship[@Id='table1']", "Type", f"{DOC_REL}/hyperlink", "Invalid table relationship"),
    ]
    for part, path, attribute, value, message in cases:
        broken = alter(good, part, path, attribute, value)
        # Repair mode may relax only IDs/header names, never structural defects.
        rejected(lambda: PACKAGE.inspect(broken, True, True), message)

    overlap = alter(good, table2, None, "ref", "B1:C2")
    rejected(lambda: PACKAGE.inspect(overlap, True, True), "Overlapping tables")
    orphan = dict(good)
    orphan["xl/tables/table3.xml"] = good[table2].replace(b"id='2'", b"id='3'", 1).replace(b"BetaTable", b"OrphanTable")
    rejected(lambda: PACKAGE.inspect(orphan, True, True), "Orphan table parts")
    duplicate_ref = alter(good, "xl/worksheets/sheet1.xml",
                          f"{{{MAIN}}}tableParts/{{{MAIN}}}tablePart[@{{{DOC_REL}}}id='table2']",
                          f"{{{DOC_REL}}}id", "table1")
    rejected(lambda: PACKAGE.inspect(duplicate_ref, True, True), "Duplicate table reference")

    defective = alter(good, table1, column2, "name", "Stale header")
    defective = alter(defective, table2, None, "id", "1")
    rejected(lambda: PACKAGE.inspect(defective), "Duplicate table IDs")
    rejected(lambda: PACKAGE.inspect(defective, allow_duplicate_ids=True),
             "Table header metadata does not match worksheet cells")
    repaired, corrections = PACKAGE.repair_contents(defective)
    assert len(corrections) == 2
    PACKAGE.inspect(repaired)
    assert set(PACKAGE.compare(defective, repaired)) == {table1, table2}
    assert ET.fromstring(repaired[table1]).find(column2).attrib["name"] == special
    assert b"&#10;" in repaired[table1], "Header line breaks must survive XML attribute normalization"
    assert all(repaired[name] == defective[name] for name in defective if name not in (table1, table2))

    non_table_change = dict(repaired)
    non_table_change["docProps/custom.xml"] += b"\n"
    rejected(lambda: PACKAGE.compare(defective, non_table_change), "Non-table content changed")
    unrelated_table_change = alter(repaired, table1, f"{{{MAIN}}}tableStyleInfo", "name", "TableStyleLight1")
    rejected(lambda: PACKAGE.compare(defective, unrelated_table_change), "Beyond the required table ID/header repair")
    rejected(lambda: PACKAGE.compare(defective, defective), "Beyond the required table ID/header repair")
    missing_member = dict(repaired)
    del missing_member["docProps/custom.xml"]
    rejected(lambda: PACKAGE.compare(defective, missing_member), "Package members were added or removed")
    return {"structural_faults_rejected": len(cases) + 3,
            "repair_preserves_unicode_escaping_and_other_members": True,
            "compare_rejects_incomplete_or_unrelated_edits": True}


def historical_regressions(current, original_path=None, previous_path=None):
    previous = dict(current)
    for part, _, old_name, new_name in HEADER_FIXES:
        current_attribute = ("name=" + quoteattr(new_name)).encode("utf-8")
        old_attribute = ("name=" + quoteattr(old_name)).encode("utf-8")
        assert previous[part].count(current_attribute) == 1, f"Missing expected corrected header in {part}"
        previous[part] = previous[part].replace(current_attribute, old_attribute, 1)
    report, tables = PACKAGE.inspect(previous, allow_header_mismatches=True)
    assert not report["duplicate_table_ids"]
    assert [(item["part"], item["cell"], item["old_name"], item["new_name"])
            for item in report["table_header_mismatches"]] == HEADER_FIXES
    rejected(lambda: PACKAGE.inspect(previous), "Table header metadata does not match worksheet cells")
    repaired, fixes = PACKAGE.repair_contents(previous, report, tables)
    assert repaired == current and len(fixes) == 3, "Old b729 metadata must repair exactly to current bytes"

    original = dict(previous)
    for part_number, old_id, new_id in ID_FIXES:
        part = f"xl/tables/table{part_number}.xml"
        attribute = f'id="{new_id}"'.encode()
        assert original[part].count(attribute) == 1, f"Missing expected corrected table ID in {part}"
        original[part] = original[part].replace(attribute, f'id="{old_id}"'.encode(), 1)
    report, tables = PACKAGE.inspect(original, True, True)
    assert report["duplicate_table_ids"] == {"57": 2, "59": 2, "60": 2, "62": 2}
    assert len(report["table_header_mismatches"]) == 3
    rejected(lambda: PACKAGE.inspect(original), "Duplicate table IDs")
    repaired, fixes = PACKAGE.repair_contents(original, report, tables)
    assert repaired == current and len(fixes) == 7, "Original metadata must repair exactly to current bytes"
    assert len(PACKAGE.compare(original, current)) == 6
    assert len(PACKAGE.compare(previous, current)) == 2
    for path, expected_sha, expected_contents in [
            (original_path, ORIGINAL_SHA, original), (previous_path, PREVIOUS_SHA, previous)]:
        if path is not None:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_sha, f"Wrong archived workbook: {path}"
            _, contents, _ = PACKAGE.load_package(path)
            assert contents == expected_contents, f"Archived workbook payload differs: {path}"
    return {"original_release_rejected": True, "previous_id_only_release_rejected": True,
            "original_repair_changes_six_table_parts": True,
            "previous_repair_changes_two_table_parts": True,
            "actual_original_verified": original_path is not None,
            "actual_previous_verified": previous_path is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path,
                        default=READER_PATH)
    parser.add_argument("--original", type=Path)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--self-test-only", action="store_true")
    args = parser.parse_args()
    report = structural_regressions()
    if not args.self_test_only:
        _, current, _ = PACKAGE.load_package(args.workbook)
        current_report, _ = PACKAGE.inspect(current)
        if args.workbook.resolve()==READER_PATH.resolve():
            manifest=read_manifest();model=load_json(MODEL_PATH)
            assert hashlib.sha256(args.workbook.read_bytes()).hexdigest()==manifest['files']['reader']['sha256']
            assert current_report['worksheets']==2 and current_report['tables']==1
            assert current_report['table_headers_checked']==len(model['columns'])==18
        else:
            assert current_report["worksheets"] in {55, 56} and current_report["tables"] == 55
            assert current_report["table_headers_checked"] == 532
            report.update(historical_regressions(current, args.original, args.previous))
        report.update({"workbook": str(args.workbook),
                       "sha256": hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
                       "worksheets_checked": current_report["worksheets"], "tables_checked": current_report['tables'], "headers_checked": current_report['table_headers_checked']})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
