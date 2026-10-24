#!/usr/bin/env python3
"""Check XLSX package integrity; repair duplicate table IDs without rewriting sheets.

Table IDs must be unique across a workbook (Microsoft Open XML documentation):
https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-tables

This is a ZIP/XML metadata repair, not a spreadsheet-content conversion. Every
unaffected package member must remain byte-identical. --repair writes a separate
output file; --compare-with verifies that only table IDs changed.
"""

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
TABLE_PART = re.compile(r"xl/tables/table(\d+)\.xml$")
ROOT_ID = re.compile(rb'(<(?:[\w]+:)?table\b[^>]*\bid=["\x27])\d+(["\x27])')


def load_package(path):
    with ZipFile(path) as package:
        assert package.testzip() is None, "Corrupt ZIP member"
        names = package.namelist()
        assert len(names) == len(set(names)), "Duplicate ZIP member name"
        infos = package.infolist()
        contents = {info.filename: package.read(info) for info in infos}
        return infos, contents, package.comment


def inspect(contents, allow_duplicate_ids=False):
    roots = {name: ET.fromstring(data) for name, data in contents.items()
             if name.endswith((".xml", ".rels"))}
    for name, root in roots.items():
        if not name.endswith(".rels"):
            continue
        rel_ids = [rel.attrib["Id"] for rel in root]
        assert len(rel_ids) == len(set(rel_ids)), f"Duplicate relationships: {name}"
        base = "" if name == "_rels/.rels" else str(PurePosixPath(name).parent.parent)
        for rel in root:
            if rel.attrib.get("TargetMode") == "External":
                continue
            target = rel.attrib["Target"].split("#", 1)[0]
            resolved = posixpath.normpath(posixpath.join(base, target)).lstrip("/")
            assert resolved in contents, f"Missing relationship target: {name} -> {resolved}"
    sheets = roots["xl/workbook.xml"].find(f"{{{MAIN}}}sheets")
    for attr in ("sheetId", "name"):
        values = [sheet.attrib[attr] for sheet in sheets]
        assert len(values) == len(set(values)), f"Duplicate worksheet {attr}"
    tables = [(name, roots[name]) for name in sorted(contents,
              key=lambda name: int(TABLE_PART.fullmatch(name).group(1))
              if TABLE_PART.fullmatch(name) else -1) if TABLE_PART.fullmatch(name)]
    for attr in ("name", "displayName"):
        values = [table.attrib[attr].casefold() for _, table in tables]
        assert len(values) == len(set(values)), f"Duplicate table {attr}"
    ids = Counter(table.attrib["id"] for _, table in tables)
    duplicates = {id_: count for id_, count in ids.items() if count > 1}
    if not allow_duplicate_ids:
        assert not duplicates, f"Duplicate table IDs: {duplicates}"
    for name, table in tables:
        columns = table.find(f"{{{MAIN}}}tableColumns")
        assert int(columns.attrib["count"]) == len(columns), f"Column count: {name}"
        col_ids = [column.attrib["id"] for column in columns]
        assert len(col_ids) == len(set(col_ids)), f"Duplicate column IDs: {name}"
        assert int(table.attrib["id"]) > 0, f"Invalid table ID: {name}"
    return {
        "members": len(contents), "worksheets": len(sheets), "tables": len(tables),
        "duplicate_table_ids": duplicates, "xml_and_relationships_valid": True,
    }, tables


def compare(before, after):
    assert before.keys() == after.keys(), "Package members were added or removed"
    changed = [name for name in before if before[name] != after[name]]
    for name in changed:
        assert TABLE_PART.fullmatch(name), f"Non-table content changed: {name}"
        assert ROOT_ID.sub(rb"\g<1>0\2", before[name], count=1) == \
               ROOT_ID.sub(rb"\g<1>0\2", after[name], count=1), f"Beyond table ID: {name}"
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--repair", type=Path, metavar="OUTPUT")
    parser.add_argument("--compare-with", type=Path, metavar="ORIGINAL")
    args = parser.parse_args()
    infos, before, comment = load_package(args.workbook)
    report, tables = inspect(before, allow_duplicate_ids=bool(args.repair))
    report["input_sha256"] = hashlib.sha256(args.workbook.read_bytes()).hexdigest()
    if args.repair:
        assert args.repair.resolve() != args.workbook.resolve(), "Use a separate output path"
        after = dict(before)
        seen = set()
        next_id = max(int(table.attrib["id"]) for _, table in tables) + 1
        repairs = []
        for name, table in tables:
            old_id = int(table.attrib["id"])
            if old_id in seen:
                replacement = str(next_id).encode()
                after[name], count = ROOT_ID.subn(
                    lambda match: match.group(1) + replacement + match.group(2),
                    before[name], count=1)
                assert count == 1, f"Could not locate root table ID: {name}"
                repairs.append({"part": name, "table": table.attrib["name"],
                                "old_id": old_id, "new_id": next_id})
                next_id += 1
            seen.add(old_id)
        inspect(after)
        changed = compare(before, after)
        stream = io.BytesIO()
        with ZipFile(stream, "w") as package:
            package.comment = comment
            for info in infos:
                package.writestr(info, after[info.filename])
        args.repair.write_bytes(stream.getvalue())
        _, reopened, _ = load_package(args.repair)
        inspect(reopened)
        assert compare(before, reopened) == changed
        report.update({"repairs": repairs, "changed_members": changed,
                       "all_other_members_byte_identical": True,
                       "output_sha256": hashlib.sha256(stream.getvalue()).hexdigest()})
    if args.compare_with:
        _, original, _ = load_package(args.compare_with)
        report["changed_members"] = compare(original, before)
        report["all_other_members_byte_identical"] = True
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
