#!/usr/bin/env python3
"""Validate XLSX tables and repair only duplicate IDs and stale header metadata.

Table IDs must be unique across a workbook. In Office, tableColumn names must
match their occupied header cells (MS-OE376 section 2.1.710(i)):
https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/b639d6d3-bc4d-4269-b6da-bb35fc1b49a0

This ZIP/XML repair does not resave worksheets. --repair writes a separate file;
--compare-with proves that its only changes are the exact minimal table metadata
repairs derived from the original. Every other package member stays byte-identical.
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
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
TABLE_PART = re.compile(r"xl/tables/table(\d+)\.xml$")
CELL_REF = re.compile(r"\$?([A-Z]{1,3})\$?([1-9][0-9]*)$")
ATTRIBUTE = re.compile(rb'\s+([\w:.-]+)\s*=\s*("[^"]*"|\x27[^\x27]*\x27)', re.S)


def load_package(path):
    with ZipFile(path) as package:
        assert package.testzip() is None, "Corrupt ZIP member"
        names = package.namelist()
        assert len(names) == len(set(names)), "Duplicate ZIP member name"
        infos = package.infolist()
        contents = {info.filename: package.read(info) for info in infos}
        return infos, contents, package.comment


def relationship_part(part):
    path = PurePosixPath(part)
    return str(path.parent / "_rels" / (path.name + ".rels"))


def resolve_target(rels_name, target):
    base = "" if rels_name == "_rels/.rels" else str(PurePosixPath(rels_name).parent.parent)
    resolved = posixpath.normpath(posixpath.join(base, target.split("#", 1)[0])).lstrip("/")
    assert not resolved.startswith("../"), f"Invalid relationship target: {rels_name}"
    return resolved


def cell_position(value):
    match = CELL_REF.fullmatch(value)
    assert match, f"Invalid cell reference: {value}"
    column = 0
    for letter in match.group(1):
        column = column * 26 + ord(letter) - ord("A") + 1
    row = int(match.group(2))
    assert column <= 16384 and row <= 1048576, f"Cell outside worksheet bounds: {value}"
    return column, row


def cell_address(column, row):
    letters = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        letters = chr(65 + remainder) + letters
    return f"{letters}{row}"


def rectangle(value):
    ends = value.split(":")
    assert len(ends) in (1, 2), f"Invalid table/filter range: {value}"
    left, top = cell_position(ends[0])
    right, bottom = cell_position(ends[-1])
    assert left <= right and top <= bottom, f"Reversed table/filter range: {value}"
    return left, top, right, bottom


def rich_text(element):
    if element is None:
        return ""
    chunks = []
    for child in element:
        if child.tag == f"{{{MAIN}}}t":
            chunks.append(child.text or "")
        elif child.tag == f"{{{MAIN}}}r":
            chunks.extend(text.text or "" for text in child.findall(f"{{{MAIN}}}t"))
    return "".join(chunks)


def header_text(cell, shared_strings, label):
    assert cell is not None, f"Missing table header cell: {label}"
    assert cell.find(f"{{{MAIN}}}f") is None, f"Formula table header needs manual review: {label}"
    kind = cell.attrib.get("t", "n")
    if kind == "inlineStr":
        value = rich_text(cell.find(f"{{{MAIN}}}is"))
    else:
        value = cell.findtext(f"{{{MAIN}}}v", "")
        if kind == "s":
            index = int(value)
            assert 0 <= index < len(shared_strings), f"Invalid shared-string header: {label}"
            value = shared_strings[index]
        else:
            assert kind in ("str", "n"), f"Unsupported table header cell type: {label}: {kind}"
    assert value, f"Empty table header cell: {label}"
    return value


def inspect(contents, allow_duplicate_ids=False, allow_header_mismatches=False):
    roots = {name: ET.fromstring(data) for name, data in contents.items()
             if name.endswith((".xml", ".rels"))}
    relationships = {}
    for name, root in roots.items():
        if not name.endswith(".rels"):
            continue
        assert root.tag == f"{{{REL}}}Relationships", f"Invalid relationship root: {name}"
        rels = root.findall(f"{{{REL}}}Relationship")
        rel_ids = [rel.attrib["Id"] for rel in rels]
        assert len(rel_ids) == len(set(rel_ids)), f"Duplicate relationships: {name}"
        relationships[name] = {rel.attrib["Id"]: rel.attrib for rel in rels}
        for rel in rels:
            if rel.attrib.get("TargetMode") == "External":
                continue
            resolved = resolve_target(name, rel.attrib["Target"])
            assert resolved in contents, f"Missing relationship target: {name} -> {resolved}"

    sheets = roots["xl/workbook.xml"].find(f"{{{MAIN}}}sheets")
    assert sheets is not None, "Missing workbook sheets"
    for attr in ("sheetId", "name"):
        values = [sheet.attrib[attr].casefold() for sheet in sheets]
        assert len(values) == len(set(values)), f"Duplicate worksheet {attr}"
    tables = [(name, roots[name]) for name in sorted(roots,
              key=lambda name: int(TABLE_PART.fullmatch(name).group(1))
              if TABLE_PART.fullmatch(name) else -1) if TABLE_PART.fullmatch(name)]
    table_names = {name for name, _ in tables}
    assert table_names == {name for name, root in roots.items()
                           if root.tag == f"{{{MAIN}}}table"}, "Unrecognised table part"
    for attr in ("name", "displayName"):
        values = [table.attrib[attr].casefold() for _, table in tables]
        assert all(values), f"Empty table {attr}"
        assert len(values) == len(set(values)), f"Duplicate table {attr}"
    ids = Counter(int(table.attrib["id"]) for _, table in tables)
    duplicates = {str(id_): count for id_, count in ids.items() if count > 1}

    shared_root = roots.get("xl/sharedStrings.xml")
    shared_strings = [rich_text(item) for item in shared_root] if shared_root is not None else []
    workbook_rels_name = relationship_part("xl/workbook.xml")
    workbook_rels = relationships[workbook_rels_name]
    owners = {}
    sheet_roots = {}
    for sheet in sheets:
        sheet_rid = sheet.attrib[f"{{{DOC_REL}}}id"]
        assert sheet_rid in workbook_rels, f"Missing worksheet relationship: {sheet.attrib['name']}"
        rel = workbook_rels[sheet_rid]
        assert rel["Type"] == f"{DOC_REL}/worksheet" and rel.get("TargetMode") != "External", \
            f"Invalid worksheet relationship: {sheet.attrib['name']}"
        sheet_part = resolve_target(workbook_rels_name, rel["Target"])
        assert sheet_part not in sheet_roots, f"Worksheet referenced more than once: {sheet_part}"
        sheet_root = roots[sheet_part]
        assert sheet_root.tag == f"{{{MAIN}}}worksheet", f"Invalid worksheet root: {sheet_part}"
        sheet_roots[sheet_part] = sheet_root
        sheet_rels_name = relationship_part(sheet_part)
        sheet_rels = relationships.get(sheet_rels_name, {})
        table_parts = sheet_root.find(f"{{{MAIN}}}tableParts")
        referenced_ids = set()
        if table_parts is not None:
            children = table_parts.findall(f"{{{MAIN}}}tablePart")
            assert int(table_parts.attrib["count"]) == len(children), f"TableParts count: {sheet_part}"
            for table_part in children:
                rid = table_part.attrib[f"{{{DOC_REL}}}id"]
                assert rid not in referenced_ids, f"Duplicate table reference: {sheet_part}: {rid}"
                referenced_ids.add(rid)
                assert rid in sheet_rels, f"Missing table relationship: {sheet_part}: {rid}"
                table_rel = sheet_rels[rid]
                assert table_rel["Type"] == f"{DOC_REL}/table" and table_rel.get("TargetMode") != "External", \
                    f"Invalid table relationship: {sheet_part}: {rid}"
                target = resolve_target(sheet_rels_name, table_rel["Target"])
                assert target in table_names, f"Invalid table target: {sheet_part}: {target}"
                assert target not in owners, f"Table referenced more than once: {target}"
                owners[target] = (sheet.attrib["name"], sheet_part)
        table_rel_ids = {rid for rid, rel in sheet_rels.items() if rel["Type"] == f"{DOC_REL}/table"}
        assert referenced_ids == table_rel_ids, f"Unreferenced table relationship: {sheet_part}"
    assert owners.keys() == table_names, f"Orphan table parts: {sorted(table_names - owners.keys())}"

    mismatches = []
    ranges_by_sheet = {}
    headers_checked = 0
    for name, table in tables:
        assert table.tag == f"{{{MAIN}}}table", f"Invalid table root: {name}"
        assert int(table.attrib["id"]) > 0, f"Invalid table ID: {name}"
        left, top, right, bottom = rectangle(table.attrib["ref"])
        header_rows = int(table.attrib.get("headerRowCount", "1"))
        totals_rows = int(table.attrib.get("totalsRowCount", "0"))
        assert header_rows in (0, 1) and totals_rows in (0, 1), f"Invalid header/totals row count: {name}"
        assert header_rows + totals_rows <= bottom - top + 1, f"Table too short for header/totals: {name}"
        columns = table.find(f"{{{MAIN}}}tableColumns")
        assert columns is not None, f"Missing table columns: {name}"
        assert int(columns.attrib["count"]) == len(columns), f"Column count: {name}"
        assert len(columns) == right - left + 1, f"Table width: {name}"
        col_ids = [int(column.attrib["id"]) for column in columns]
        assert all(value > 0 for value in col_ids), f"Invalid column ID: {name}"
        assert len(col_ids) == len(set(col_ids)), f"Duplicate column IDs: {name}"
        col_names = [column.attrib["name"].casefold() for column in columns]
        assert all(col_names), f"Empty column name: {name}"
        assert len(col_names) == len(set(col_names)), f"Duplicate column names: {name}"
        auto_filter = table.find(f"{{{MAIN}}}autoFilter")
        if auto_filter is not None:
            assert rectangle(auto_filter.attrib["ref"]) == (left, top, right, bottom - totals_rows), \
                f"AutoFilter range: {name}"
        sheet_name, sheet_part = owners[name]
        for other_name, (l2, t2, r2, b2) in ranges_by_sheet.setdefault(sheet_part, []):
            assert right < l2 or r2 < left or bottom < t2 or b2 < top, \
                f"Overlapping tables: {name} and {other_name}"
        ranges_by_sheet[sheet_part].append((name, (left, top, right, bottom)))
        if not header_rows:
            continue
        row = sheet_roots[sheet_part].find(f"{{{MAIN}}}sheetData/{{{MAIN}}}row[@r='{top}']")
        cells = {cell.attrib["r"]: cell for cell in row} if row is not None else {}
        actual_names = []
        for index, column in enumerate(columns):
            address = cell_address(left + index, top)
            value = header_text(cells.get(address), shared_strings, f"{sheet_name}!{address}")
            actual_names.append(value.casefold())
            headers_checked += 1
            if value != column.attrib["name"]:
                mismatches.append({"part": name, "table": table.attrib["name"],
                                   "sheet": sheet_name, "cell": address, "column_index": index,
                                   "column_id": int(column.attrib["id"]),
                                   "old_name": column.attrib["name"], "new_name": value})
        assert len(actual_names) == len(set(actual_names)), f"Duplicate occupied header cells: {name}"
    if not allow_duplicate_ids:
        assert not duplicates, f"Duplicate table IDs: {duplicates}"
    if not allow_header_mismatches:
        assert not mismatches, "Table header metadata does not match worksheet cells: " + \
            "; ".join(f"{item['sheet']}!{item['cell']} ({item['part']})" for item in mismatches)
    return {
        "members": len(contents), "worksheets": len(sheets), "tables": len(tables),
        "table_headers_checked": headers_checked, "duplicate_table_ids": duplicates,
        "table_header_mismatches": mismatches, "xml_and_relationships_valid": True,
        "table_structure_valid": True,
    }, tables


def tag_pattern(local_name):
    return re.compile(rb'<(?:[\w.-]+:)?' + local_name +
                      rb'(?=[\s/>])(?:[^>"\x27]|"[^"]*"|\x27[^\x27]*\x27)*>', re.S)


def replace_attribute(tag, attribute, value):
    matches = [match for match in ATTRIBUTE.finditer(tag) if match.group(1) == attribute]
    assert len(matches) == 1, f"Expected one {attribute.decode()} attribute"
    match = matches[0]
    quote = match.group(2)[:1]
    escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace('"', "&quot;") if quote == b'"' else escaped.replace("'", "&apos;")
    escaped = escaped.replace("\t", "&#9;").replace("\n", "&#10;").replace("\r", "&#13;")
    start, end = match.span(2)
    return tag[:start + 1] + escaped.encode("utf-8") + tag[end - 1:]


def repair_contents(before, report=None, tables=None):
    if report is None or tables is None:
        report, tables = inspect(before, allow_duplicate_ids=True, allow_header_mismatches=True)
    after = dict(before)
    repairs = []
    seen = set()
    next_id = max((int(table.attrib["id"]) for _, table in tables), default=0) + 1
    for name, table in tables:
        old_id = int(table.attrib["id"])
        if old_id in seen:
            after[name], count = tag_pattern(b"table").subn(
                lambda match: replace_attribute(match.group(), b"id", str(next_id)), after[name], count=1)
            assert count == 1, f"Could not locate root table ID: {name}"
            repairs.append({"kind": "duplicate_table_id", "part": name,
                            "table": table.attrib["name"], "old_id": old_id, "new_id": next_id})
            next_id += 1
        seen.add(old_id)
        replacements = {item["column_index"]: item for item in report["table_header_mismatches"]
                        if item["part"] == name}
        if replacements:
            matches = list(tag_pattern(b"tableColumn").finditer(after[name]))
            assert len(matches) == len(table.find(f"{{{MAIN}}}tableColumns")), \
                f"Could not locate every tableColumn tag: {name}"
            for index in sorted(replacements, reverse=True):
                item = replacements[index]
                match = matches[index]
                replacement = replace_attribute(match.group(), b"name", item["new_name"])
                after[name] = after[name][:match.start()] + replacement + after[name][match.end():]
            repairs.extend({"kind": "table_header_name", **replacements[index]}
                           for index in sorted(replacements))
    return after, repairs


def compare(before, after):
    assert before.keys() == after.keys(), "Package members were added or removed"
    changed = [name for name in before if before[name] != after[name]]
    for name in changed:
        assert TABLE_PART.fullmatch(name), f"Non-table content changed: {name}"
    expected, _ = repair_contents(before)
    for name in before:
        assert after[name] == expected[name], f"Beyond the required table ID/header repair: {name}"
    inspect(after)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--repair", type=Path, metavar="OUTPUT")
    parser.add_argument("--compare-with", type=Path, metavar="ORIGINAL")
    args = parser.parse_args()
    infos, before, comment = load_package(args.workbook)
    report, tables = inspect(before, allow_duplicate_ids=bool(args.repair),
                             allow_header_mismatches=bool(args.repair))
    report["input_sha256"] = hashlib.sha256(args.workbook.read_bytes()).hexdigest()
    if args.repair:
        assert args.repair.resolve() != args.workbook.resolve(), "Use a separate output path"
        after, repairs = repair_contents(before, report, tables)
        changed = compare(before, after)
        stream = io.BytesIO()
        with ZipFile(stream, "w") as package:
            package.comment = comment
            for info in infos:
                package.writestr(info, after[info.filename])
        args.repair.write_bytes(stream.getvalue())
        _, reopened, reopened_comment = load_package(args.repair)
        assert reopened == after and reopened_comment == comment, "ZIP write changed package contents"
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
