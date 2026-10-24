#!/usr/bin/env python3
"""Assemble artifact-authored presentation resources into the native XLSX.

The artifact renderer cannot import this research package. Its presentation is
therefore authored separately by build-workbook-presentation.mjs. This assembler
copies those exported styles and dimensions into the original ZIP, retaining all
cell payloads, formula caches and native research features. No workbook engine
rewrites the research data. GitHub Actions needs only Python's standard library.
"""
import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import posixpath
import re
import textwrap
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
M = "{" + MAIN + "}"
ET.register_namespace("x", MAIN)
CELL = re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*>')
ROW = re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>')
ATTR = lambda name: re.compile(rb'\s' + name.encode() + rb'="[^"]*"')
RESOURCE = ROOT / "source/workbook-presentation.json"
HEIGHTS = [10, 12, 18, 24, 26, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84,
           90, 96, 108, 120, 132, 144, 156, 168, 180, 192, 216, 240, 264,
           288, 312, 336, 360, 384, 396]
WIDTHS = list(range(10, 141))
ROLES = ["title", "context", "header", "blank", "body0", "body1",
         "number0", "number1", "key0", "key1", "link0", "link1"]


def read_package(path):
    with ZipFile(path) as z:
        assert z.testzip() is None, "Corrupt XLSX member"
        infos = z.infolist()
        return infos, {x.filename: z.read(x) for x in infos}, z.comment


def xml(element):
    return ET.tostring(element, encoding="unicode")


def col_index(label):
    out = 0
    for char in label: out = out * 26 + ord(char) - 64
    return out


def col_name(index):
    out = ""
    while index:
        index, digit = divmod(index - 1, 26)
        out = chr(digit + 65) + out
    return out


def cell_address(address):
    match = re.fullmatch(r"([A-Z]+)(\d+)", address)
    assert match, address
    return col_index(match[1]), int(match[2])


def shared_strings(contents):
    root = ET.fromstring(contents["xl/sharedStrings.xml"]) if "xl/sharedStrings.xml" in contents else []
    return ["".join(node.itertext()) for node in root]


def value(cell, strings):
    raw = cell.find(M + "v")
    typ = cell.get("t", "n")
    if typ == "s": return strings[int(raw.text)] if raw is not None else ""
    if typ == "inlineStr": return "".join(cell.find(M + "is").itertext())
    if raw is None or raw.text is None: return None
    if typ == "b": return raw.text == "1"
    if typ == "n":
        try: return float(raw.text) if "." in raw.text else int(raw.text)
        except ValueError: return raw.text
    return raw.text


def table_for_sheet(contents, number):
    path = f"xl/worksheets/_rels/sheet{number}.xml.rels"
    relationships = ET.fromstring(contents[path])
    targets = [posixpath.normpath(posixpath.join("xl/worksheets", r.get("Target"))).lstrip("/")
               for r in relationships if r.get("Type", "").endswith("/table")]
    assert len(targets) == 1, f"Expected one existing native table on sheet {number}"
    return targets[0], ET.fromstring(contents[targets[0]])


def display_text(cell, strings, format_code):
    v = value(cell, strings)
    if v is None: return ""
    if cell.get("t") == "d":
        return str(v)[:16].replace("T", " ") if "hh" in format_code else str(v)[:10]
    return str(v)


def fitted_height(texts, widths, minimum=30, maximum=396):
    lines = 1
    for text, width in zip(texts, widths):
        capacity = max(5, int(width * 1.05) - 2)
        count = sum(max(1, len(textwrap.wrap(part, width=capacity, break_long_words=True,
                                               replace_whitespace=False)))
                    for part in str(text).splitlines()) or 1
        lines = max(lines, count)
    required = min(maximum, max(minimum, math.ceil(lines * 12.5 + 10)))
    return next((height for height in HEIGHTS if height >= required), HEIGHTS[-1])


def old_format(styles, style_id):
    xf = styles.find(M + "cellXfs")[style_id]
    font = styles.find(M + "fonts")[int(xf.get("fontId", 0))]
    fill = styles.find(M + "fills")[int(xf.get("fillId", 0))]
    font_cfg = {"name": "Arial", "size": 10, "color": "#223444"}
    for child in font:
        tag = child.tag.split("}")[-1]
        if tag == "name": font_cfg["name"] = child.get("val")
        if tag == "sz": font_cfg["size"] = float(child.get("val"))
        if tag in ("b", "i"): font_cfg[{"b": "bold", "i": "italic"}[tag]] = child.get("val", "1") != "0"
        if tag == "color" and child.get("rgb"): font_cfg["color"] = "#" + child.get("rgb")[-6:]
    cfg = {"font": font_cfg, "wrapText": True, "verticalAlignment": "top", "fill": "#FFFFFF"}
    fg = fill.find(".//" + M + "fgColor")
    if fg is not None and fg.get("rgb"): cfg["fill"] = "#" + fg.get("rgb")[-6:]
    align = xf.find(M + "alignment")
    if align is not None:
        cfg["wrapText"] = align.get("wrapText", "0") == "1"
        if align.get("horizontal") in {"left", "right", "center"}: cfg["horizontalAlignment"] = align.get("horizontal")
        cfg["verticalAlignment"] = {"center": "center", "bottom": "bottom"}.get(align.get("vertical"), "top")
    return cfg


def model_for(contents):
    strings = shared_strings(contents)
    styles = ET.fromstring(contents["xl/styles.xml"])
    formats = {int(x.get("numFmtId")): x.get("formatCode") for x in styles.find(M + "numFmts")}
    xfs = styles.find(M + "cellXfs")
    sheets = []
    names = [s.get("name") for s in ET.fromstring(contents["xl/workbook.xml"]).find(M + "sheets")]
    for index, name in enumerate(names, 1):
        path = f"xl/worksheets/sheet{index}.xml"
        root = ET.fromstring(contents[path])
        table_path, table = table_for_sheet(contents, index)
        first, last = table.get("ref").split(":")
        first_col, header = cell_address(first)
        last_col, last_row = cell_address(last)
        assert first_col == 1
        columns = root.find(M + "cols")
        old_widths = [18.0] * last_col
        if columns is not None:
            for column in columns:
                for c in range(int(column.get("min")), min(last_col, int(column.get("max"))) + 1):
                    old_widths[c - 1] = float(column.get("width", 18))
        # Keep compact categorical/key columns. Give long research prose enough
        # horizontal room so off-screen notes do not make every record very tall.
        widths = [max(14, min(140, round(w))) for w in old_widths]
        widths = [110 if 55 <= width <= 110 else width for width in widths]
        if name == "Register": widths = [15, 24, 48, 19, 56, 28, 44, 18, 44, 100, 110, 110, 32, 110, 66, 26, 40, 110, 18, 18, 34, 24, 110, 34, 110]
        if name in {"Codebook", "Coverage"}: widths = [30, 96]
        if name == "Release summary": widths = [34, 36, 84]
        if name == "Claim checks": widths = [16, 19, 34, 44, 27, 84]
        if name == "Locations": widths[:5] = [28, 44, 38, 16, 16]
        freeze_rows = 0 if name == "Release summary" else header
        freeze_cols = 0 if last_col <= 3 else (2 if name in {"Chronology phases", "Phase locations", "Relationships"} else 1)
        rows, sample, cell_styles = {}, [], {}
        merge_node = root.find(M + "mergeCells")
        merge_refs = [m.get("ref") for m in merge_node] if merge_node is not None else []
        hyperlink_cells = {h.get("ref") for h in root.findall(".//" + M + "hyperlink")}
        for row in root.find(M + "sheetData"):
            number = int(row.get("r"))
            texts = [""] * last_col
            cells = []
            for cell in row:
                c, r = cell_address(cell.get("r"))
                if c > last_col: continue
                style_id = int(cell.get("s", 0))
                fmt_id = int(xfs[style_id].get("numFmtId", 0))
                fmt = formats.get(fmt_id, "General")
                text = display_text(cell, strings, fmt)
                texts[c - 1] = text
                formula = cell.find(M + "f")
                is_link = cell.get("r") in hyperlink_cells or (formula is not None and "HYPERLINK(" in (formula.text or "").upper())
                if r == header: role = "header"
                elif r < header: role = "title" if r == 2 else ("context" if r == 3 else "blank")
                elif is_link: role = "link" + str((r - header - 1) % 2)
                elif c <= max(1, freeze_cols): role = "key" + str((r - header - 1) % 2)
                elif cell.get("t", "n") in {"n", "d"} and cell.find(M + "v") is not None: role = "number" + str((r - header - 1) % 2)
                elif text.startswith(("https://", "http://")): role = "link" + str((r - header - 1) % 2)
                else: role = "body" + str((r - header - 1) % 2)
                cell_styles[cell.get("r")] = (role, fmt_id)
                if number <= header + 7:
                    cells.append({"address": cell.get("r"), "value": value(cell, strings),
                                  "type": cell.get("t", "n"), "numberFormat": fmt,
                                  "role": role, "originalStyle": old_format(styles, style_id)})
            if number == header:
                height = fitted_height(texts, widths, minimum=42, maximum=84)
            elif number < header:
                height = 26 if number == 2 else (30 if number == 3 else (12 if number == 1 else 10))
            else:
                height = fitted_height(texts, widths, minimum=24)
            rows[number] = height
            if number <= header + 7:
                sample.append({"number": number, "height": height,
                               "oldHeight": float(row.get("ht", 15)), "cells": cells})
        sheets.append({"name": name, "path": path, "tablePath": table_path,
                       "tableName": table.get("name"), "tableRef": table.get("ref"),
                       "headerRow": header, "lastColumn": last_col, "lastRow": last_row,
                       "widths": widths, "oldWidths": old_widths,
                       "freezeRows": freeze_rows, "freezeColumns": freeze_cols,
                       "rows": rows, "sample": sample, "cellStyles": cell_styles,
                       "merges": merge_refs})
    return {"schema": 1, "heights": HEIGHTS, "widths": WIDTHS, "roles": ROLES, "sheets": sheets}


def export_model(source, destination):
    _, contents, _ = read_package(source)
    model = model_for(contents)
    for sheet in model["sheets"]:
        del sheet["cellStyles"]
        del sheet["rows"]
    Path(destination).write_text(json.dumps(model, ensure_ascii=False))


def extract_resources(artifact, manifest, destination):
    _, contents, _ = read_package(artifact)
    meta = json.loads(Path(manifest).read_text())
    styles = ET.fromstring(contents["xl/styles.xml"])
    sheets = list(ET.fromstring(contents["xl/workbook.xml"]).find(M + "sheets"))
    rels = {x.get("Id"): x.get("Target") for x in ET.fromstring(contents["xl/_rels/workbook.xml.rels"])}
    resources = {"schema": 1, "author": "@oai/artifact-tool", "builder": "scripts/build-workbook-presentation.mjs",
                 "styles": xml(styles), "roles": {}, "widths": {}, "heights": {}, "sheets": {}}
    for sheet in sheets:
        target = rels[sheet.get("{" + REL + "}id")]
        path = posixpath.normpath(posixpath.join("xl", target)).lstrip("/")
        root = ET.fromstring(contents[path])
        if sheet.get("name") == "Presentation resources":
            cells = {c.get("r"): c for c in root.findall(".//" + M + "c")}
            resources["roles"] = {role: int(cells[address].get("s", 0)) for role, address in meta["roles"].items()}
            resources["heights"] = {str(height): dict(root.find(M + "sheetData").find(f"{M}row[@r='{row}']").attrib)
                                    for height, row in meta["heights"].items()}
            cols = root.find(M + "cols")
            for width, number in meta["widths"].items():
                match = next(c for c in cols if int(c.get("min")) <= number <= int(c.get("max")))
                resources["widths"][width] = dict(match.attrib)
        else:
            resources["sheets"][sheet.get("name")] = {tag: xml(root.find(M + tag)) for tag in ["sheetViews", "sheetPr"] if root.find(M + tag) is not None}
    assert len(resources["sheets"]) == 55
    assert set(resources["roles"]) == set(ROLES)
    Path(destination).write_text(json.dumps(resources, ensure_ascii=False, indent=2) + "\n")


def set_attr(tag, name, value):
    tag = ATTR(name).sub(b"", tag)
    ending = b' />' if tag.endswith(b'/>') else b'>'
    stem = tag[:-2].rstrip() if tag.endswith(b'/>') else tag[:-1]
    return stem + b' ' + name.encode() + b'="' + str(value).encode() + b'"' + ending


def replace_element(data, tag, replacement, before=None):
    pattern = re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?' + tag.encode() + rb'\b[^>]*(?:/>|>.*?</(?:[A-Za-z_][\w.-]*:)?' + tag.encode() + rb'>)', re.S)
    if pattern.search(data): return pattern.sub(replacement.encode(), data, count=1)
    if before:
        anchor = re.search(rb'<(?:[A-Za-z_][\w.-]*:)?' + before.encode() + rb'\b', data)
        assert anchor, before
        return data[:anchor.start()] + replacement.encode() + data[anchor.start():]
    close = data.rfind(b'</')
    return data[:close] + replacement.encode() + data[close:]


def apply_presentation(source, destination, resources_path=RESOURCE):
    infos, before, comment = read_package(source)
    model = model_for(before)
    resources = json.loads(Path(resources_path).read_text())
    assert resources["author"] == "@oai/artifact-tool"
    styles = ET.fromstring(before["xl/styles.xml"])
    authored = ET.fromstring(resources["styles"])
    offsets = {}
    for group in ["fonts", "fills", "borders"]:
        existing = styles.find(M + group)
        offsets[group] = len(existing)
        existing.extend(deepcopy(list(authored.find(M + group))))
        existing.set("count", str(len(existing)))
    xfs = styles.find(M + "cellXfs")
    role_xfs = authored.find(M + "cellXfs")
    mapping = {}
    for role, fmt_id in sorted(set(choice for sheet in model["sheets"] for choice in sheet["cellStyles"].values())):
        xf = deepcopy(role_xfs[resources["roles"][role]])
        for attr, group in [("fontId", "fonts"), ("fillId", "fills"), ("borderId", "borders")]:
            xf.set(attr, str(int(xf.get(attr, 0)) + offsets[group]))
        xf.set("numFmtId", str(fmt_id))
        xf.set("xfId", "0")
        mapping[(role, fmt_id)] = len(xfs)
        xfs.append(xf)
    xfs.set("count", str(len(xfs)))
    after = dict(before)
    after["xl/styles.xml"] = ET.tostring(styles, encoding="utf-8", xml_declaration=True)
    for sheet in model["sheets"]:
        data = before[sheet["path"]]
        def style_cell(match):
            tag = match.group()
            address = re.search(rb'\br="([^"]+)"', tag).group(1).decode()
            choice = sheet["cellStyles"].get(address)
            if choice is None: return tag
            return set_attr(tag, "s", mapping[choice])
        data = CELL.sub(style_cell, data)
        def height_row(match):
            tag = match.group()
            number = int(re.search(rb'\br="(\d+)"', tag).group(1))
            if number not in sheet["rows"]: return tag
            authored_row = resources["heights"][str(sheet["rows"][number])]
            for name in ["ht", "customHeight"]:
                if name in authored_row: tag = set_attr(tag, name, authored_row[name])
            return tag
        data = ROW.sub(height_row, data)
        old_columns = ET.fromstring(before[sheet["path"]]).find(M + "cols")
        columns = ET.Element(M + "cols")
        for index, width in enumerate(sheet["widths"], 1):
            attrs = dict(resources["widths"][str(width)])
            attrs.update(min=str(index), max=str(index))
            if old_columns is not None:
                old = next((c for c in old_columns if int(c.get("min")) <= index <= int(c.get("max"))), None)
                if old is not None:
                    for key in ["hidden", "outlineLevel", "collapsed"]:
                        if key in old.attrib: attrs[key] = old.get(key)
            columns.append(ET.Element(M + "col", attrs))
        data = replace_element(data, "cols", xml(columns), before="sheetData")
        view = resources["sheets"][sheet["name"]].get("sheetViews")
        if view: data = replace_element(data, "sheetViews", view, before="sheetData")
        # Tab colour is a presentation hint; retain other sheet properties.
        prop = resources["sheets"][sheet["name"]].get("sheetPr")
        if prop:
            old_prop = ET.fromstring(before[sheet["path"]]).find(M + "sheetPr")
            colour = ET.fromstring(prop).find(M + "tabColor")
            if colour is not None:
                merged = deepcopy(old_prop) if old_prop is not None else ET.Element(M + "sheetPr")
                prior = merged.find(M + "tabColor")
                if prior is not None: merged.remove(prior)
                merged.insert(0, colour)
                data = replace_element(data, "sheetPr", xml(merged), before="sheetViews")
        after[sheet["path"]] = data
    with ZipFile(destination, "w") as z:
        z.comment = comment
        for info in infos: z.writestr(info, after[info.filename])
    return verify_presentation(source, destination)


def stripped_sheet(data):
    root = ET.fromstring(data)
    for tag in ["cols", "sheetViews"]:
        node = root.find(M + tag)
        if node is not None: root.remove(node)
    prop = root.find(M + "sheetPr")
    if prop is not None:
        colour = prop.find(M + "tabColor")
        if colour is not None: prop.remove(colour)
        if len(prop) == 0 and not prop.attrib: root.remove(prop)
    for row in root.find(M + "sheetData"):
        row.attrib.pop("ht", None)
        row.attrib.pop("customHeight", None)
        for cell in row: cell.attrib.pop("s", None)
    return ET.tostring(root)


def verify_presentation(source, destination):
    _, before, _ = read_package(source)
    _, after, _ = read_package(destination)
    reader_layout = None
    if "xl/worksheets/sheet56.xml" in after:
        spec = importlib.util.spec_from_file_location("reader_layout", ROOT / "scripts/workbook-reader-layout.py")
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        after, reader_layout = reader.normalized_for_presentation(before, after)
    assert before.keys() == after.keys(), "Package parts changed"
    old_styles = ET.fromstring(before["xl/styles.xml"])
    new_styles = ET.fromstring(after["xl/styles.xml"])
    for section in old_styles:
        current = new_styles.find(section.tag)
        assert current is not None, "Native style section removed"
        if section.tag.split("}")[-1] in {"fonts", "fills", "borders", "cellXfs"}:
            assert len(current) >= len(section)
            assert [xml(node) for node in current[:len(section)]] == [xml(node) for node in section], "Existing style records changed"
        else:
            assert xml(section) == xml(current), "Native formats, conditional styles or named styles changed"
    old_xfs, new_xfs = old_styles.find(M + "cellXfs"), new_styles.find(M + "cellXfs")
    changed = []
    formula_count, cells = 0, 0
    for path, original in before.items():
        if original == after[path]: continue
        changed.append(path)
        if path == "xl/styles.xml": continue
        assert re.fullmatch(r"xl/worksheets/sheet\d+\.xml", path), f"Unexpected modified part: {path}"
        assert stripped_sheet(original) == stripped_sheet(after[path]), f"Non-presentation change: {path}"
        old_cells = ET.fromstring(original).findall(".//" + M + "c")
        new_cells = ET.fromstring(after[path]).findall(".//" + M + "c")
        for cell, current in zip(old_cells, new_cells):
            cells += 1
            formula_count += cell.find(M + "f") is not None
            old_fmt = old_xfs[int(cell.get("s", 0))].get("numFmtId", "0")
            new_fmt = new_xfs[int(current.get("s", 0))].get("numFmtId", "0")
            assert old_fmt == new_fmt, f"Number/date format changed: {path} {cell.get('r')}"
    assert before["xl/workbook.xml"] == after["xl/workbook.xml"], "Worksheet order/names changed"
    report = {"input_sha256": hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            "output_sha256": hashlib.sha256(Path(destination).read_bytes()).hexdigest(),
            "changed_members": changed, "worksheet_count": 56 if reader_layout else 55,
            "original_worksheet_count": 55,
            "cell_payloads_preserved": cells, "formula_payloads_preserved": formula_count,
            "native_features_preserved": True, "research_content_unchanged": True}
    if reader_layout: report["reader_layout"] = reader_layout
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("model"); p.add_argument("source"); p.add_argument("output")
    p = sub.add_parser("resources"); p.add_argument("artifact"); p.add_argument("manifest"); p.add_argument("output")
    p = sub.add_parser("apply"); p.add_argument("source"); p.add_argument("output"); p.add_argument("--resources", default=str(RESOURCE))
    p = sub.add_parser("verify"); p.add_argument("source"); p.add_argument("output")
    args = parser.parse_args()
    if args.command == "model": export_model(args.source, args.output)
    elif args.command == "resources": extract_resources(args.artifact, args.manifest, args.output)
    elif args.command == "apply": print(json.dumps(apply_presentation(args.source, args.output, args.resources), indent=2))
    else: print(json.dumps(verify_presentation(args.source, args.output), indent=2))


if __name__ == "__main__": main()
