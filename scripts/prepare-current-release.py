#!/usr/bin/env python3
"""Prepare the current, audited REC50 input without changing research conclusions.

This is a release preparation command, not a source-research or site-build step.
The immutable R50 package, compact state and accepted-round receipts are required.
Example:
  python scripts/prepare-current-release.py --programme /path/to/research/recovery-50

The checked-in gzip is the build input. Re-running this preparation command needs
the preserved programme archive; ordinary site builds do not rerun research.
"""
from __future__ import annotations

import argparse
import collections
import copy
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
EXPECTED_STATE = "d9036cb8d241de5bcef39e99c6d97d62e573b59e5e02097a79a10cbf355eb39e"
COUNTRY_ALIASES = {
    "Turkey": ["Türkiye"],
    "Czech Republic": ["Czechia"],
    "Republic of Congo": ["Republic of the Congo"],
    "Kosovo": ["Kosovo (disputed status)"],
    "Kosovo (disputed boundary)": ["Kosovo (disputed status)"],
    "Palestine (occupied West Bank)": ["Palestine"],
    "Palestine (West Bank and Gaza)": ["Palestine"],
    "Palestine (Gaza)": ["Palestine"],
    "Moldova (Transnistrian segment)": ["Moldova"],
    "Belarus (rail transit approach)": ["Belarus"],
    "Iraq (Kurdistan Region)": ["Iraq"],
    "North Macedonia (then Macedonia / FYROM)": ["North Macedonia"],
    "Georgia / Abkhazia": ["Georgia", "Abkhazia (de facto territory)"],
    "Russia and other non-EU arrival territories": ["Russia"],
    "foreign destinations not exhaustively identified": [],
    "neighbouring export destinations": [],
    "Kaliningrad transit context": [],
}
DISPLAY_ALIASES = {
    "Turkey": "Türkiye", "Czech Republic": "Czechia",
    "Republic of Congo": "Republic of the Congo",
    "Kosovo": "Kosovo (disputed status)",
    "Kosovo (disputed boundary)": "Kosovo (disputed status)",
}

# These fifteen parents have neither a Dimensions row nor a recorded Locations
# country context. Every mapping below is limited to the retained phase/source
# description. The other thirty-three missing Dimensions rows already have
# explicit recorded country context in Locations, which is restored as text only.
PHASE_COUNTRY_REPAIRS = {
    "C7-AF-001": (["South Africa", "Eswatini"],
        "The retained SARS and SABC evidence identifies Mananga, Mpumalanga and the Eswatini protest context; this is country context only."),
    "C7-AF-002": (["Democratic Republic of the Congo"],
        "The phase expressly concerns international departure from DRC. Unnamed destinations are not enumerated."),
    "C7-AM-001": (["Brazil", "Uruguay"],
        "The phase scope and direction expressly say land entry from Uruguay into Brazil."),
    "C7-AM-002": (["Nicaragua", "Costa Rica"],
        "The affected passage is Costa Rica into Nicaragua at Peñas Blancas. Panama is the travellers' earlier origin, not another affected frontier."),
    "C7-EH-001": (["Eritrea", "Sudan"],
        "The phase direction is Sudan to Eritrea at Laffa."),
    "C7-ME-001": (["Israel", "Palestine (Gaza)"],
        "The retained OCHA scope is Kerem Shalom entry into Gaza, with Israeli authorities and the Palestinian Authority identified."),
    "C7-EU-001": (["Cyprus"],
        "The retained Commission account concerns named Green Line crossings and Turkish Cypriot-side access. Türkiye is not inferred as an affected frontier."),
    "C7-EU-002": (["Latvia", "Belarus", "Russia"],
        "The named Latvian posts and retained legal/source titles distinguish entry from the Belarusian and Russian frontiers."),
    "C7-EU-003": (["Romania"],
        "The recorded Romanian Infotrafic/Satu Mare context supports Romania. A source's Ukrainian-frontier claim was expressly rejected; no verified counterpart is supplied by the preserved reference."),
    "C7-EU-004": (["France", "Spain"],
        "The phase expressly identifies the A63 France–Spain approach at Biriatou."),
    "C7-SC-001": (["Afghanistan", "Iran"],
        "Both phases expressly record Afghanistan-to-Iran tourist-visa passage."),
    "C7-SC-002": (["Afghanistan", "Iran"],
        "The phase direction and source title expressly identify the Afghanistan–Iran Abresham crossing."),
    "C7-SC-003": (["Georgia", "South Ossetia (de facto territory)"],
        "The qualification expressly identifies South Ossetia/Georgian-administered territory. The entity label is qualified and makes no sovereignty or geometry determination."),
    "C7-SC-004": (["Nepal", "India"],
        "The phase identifies Nepali and Indian district authorities and the Darchula/Dharchula frontier."),
    "C7-SC-005": (["Pakistan", "Afghanistan"],
        "The phase direction expressly says Pakistan to Afghanistan at Torkham."),
}
URZICENI_LIMIT = (
    "Country-filter context: Romania is supported by the retained Romanian "
    "Infotrafic/Satu Mare evidence. The counterpart remains unresolved in this "
    "release; a source's Ukrainian-frontier identification was rejected. "
    "No counterpart country or point location is inferred from the crossing name."
)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    raw = Path(path).read_bytes()
    return json.loads(gzip.decompress(raw) if str(path).endswith(".gz") else raw)


def write(path, value):
    raw = encoded(value)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0)
                          if str(path).endswith(".gz") else raw + b"\n")


def unique(values):
    return list(dict.fromkeys(values))


def tokens(value):
    return [v.strip() for v in str(value or "").split(";") if v.strip()]


def normalize_countries(values):
    return unique(c for value in values for c in COUNTRY_ALIASES.get(value, [value]))


def native_tables(state):
    tables, preambles, actual_headers, recovered = {}, {}, {}, []
    for name, cached_headers in state["headers"].items():
        rows = state["rows"][name]
        headers = cached_headers
        if not headers:
            # The compact cache omitted this historical sheet's heading. Its
            # literal authored header is present after the title and note.
            assert name == "COVID screen"
            headers = rows[4]
            assert headers == ["COBAP ID", "Country or territory label", "Policy type", "Start as recorded",
                               "End as recorded", "Selection basis", "Review status", "Screening note", "Dataset source"]
            recovered.append({"sheet": name, "cached_header": cached_headers, "source_row_index_zero_based": 4,
                              "literal_header_recovered": headers,
                              "reason": "Recover the authentic historical sheet header from native rows; the compact header cache was empty."})
        assert headers and len(headers) == len(set(headers)) and None not in headers, name
        index = rows.index(headers)
        assert all(len(r) <= len(headers) for r in rows[index + 1:]), (name, "Unrepresented trailing cells")
        actual_headers[name] = copy.deepcopy(headers)
        preambles[name] = [copy.deepcopy(r) for r in rows[:index] if any(v is not None for v in r)]
        tables[name] = [dict(zip(headers, r)) for r in rows[index + 1:]
                        if r and r[0] is not None and r != headers]
        reconstructed = [[record.get(h) for h in headers] for record in tables[name]]
        source_rows = [r + [None] * (len(headers) - len(r)) for r in rows[index + 1:]
                       if r and r[0] is not None and r != headers]
        assert reconstructed == source_rows, (name, "Native cell content was lost")
    return tables, preambles, actual_headers, recovered


def row_index(tables, name, key):
    result = {r[key]: r for r in tables[name]}
    assert len(result) == len(tables[name]), (name, "duplicate key")
    return result


def prepare_countries(tables, source_urls, reader, audit):
    registers = row_index(tables, "Register", "ID")
    dimensions = row_index(tables, "Dimensions", "ID")
    phases = collections.defaultdict(list)
    locations = collections.defaultdict(list)
    sources = collections.defaultdict(list)
    for r in tables["Chronology phases"]:
        phases[r["Parent record ID"]].append(r)
    for r in tables["Locations"]:
        for rid in tokens(r["Linked records"]):
            locations[rid].append(r)
    for r in tables["Source index"]:
        sources[r["Record ID"]].append(r)
    old_reader = {r[0]: r for r in reader["rows"]}
    missing = set(registers) - set(dimensions)
    assert len(missing) == 48
    country_map, display_map, notes = {}, {}, {}
    for rid in registers:
        raw = dimensions.get(rid, {}).get("Countries or territories")
        values = tokens(raw)
        basis = "Native Dimensions country/entity text; normalized only for filters."
        if rid in missing:
            if rid in PHASE_COUNTRY_REPAIRS:
                values, basis = PHASE_COUNTRY_REPAIRS[rid]
            else:
                values = unique(v for row in locations[rid] for v in tokens(row["Countries"]))
                assert values, (rid, "No recorded country context")
                basis = ("Country/entity text restored from the existing Locations record context, "
                         "cross-read with retained phase scope. No coordinate or phase-location approval is inferred.")
        normalized = normalize_countries(values)
        assert normalized and all(v and ";" not in v for v in normalized), rid
        country_map[rid] = normalized
        display_map[rid] = "; ".join(unique(DISPLAY_ALIASES.get(v, v) for v in values))
        if rid in missing:
            audit["country_repairs"].append({
                "record_id": rid, "old_dimensions_value": None,
                "old_reader_value": old_reader[rid][2],
                "new_filter_values": normalized, "new_reader_value": display_map[rid],
                "reason": basis,
                "recorded_location_context": [{k: r.get(k) for k in
                    ["Location ID", "Countries", "Name / original scope text", "Coordinate status",
                     "Historical / phase qualification"]} for r in locations[rid]],
                "phase_evidence": [{k: r.get(k) for k in
                    ["Phase ID", "Movement / crossing / phase scope", "Direction", "Authority",
                     "Evidence basis", "Qualification", "Source IDs", "Source URLs"]} for r in phases[rid]],
                "source_index_scope_notes": [{k: r.get(k) for k in
                    ["Source labels — all retrievals", "Source URL", "Claims by retrieval label"]}
                    for r in sources[rid]],
                "source_urls": source_urls[rid], "geometry_change": False,
            })
        if values != normalized:
            audit["country_normalizations"].append({
                "record_id": rid, "old_native_value": raw, "recorded_tokens": values,
                "filter_values": normalized, "reader_value": display_map[rid],
                "reason": "Alias normalization or separation of named entities from scope qualifiers. Original native text and affected-scope qualifications remain unchanged.",
            })
        if rid == "C7-EU-003":
            notes[rid] = URZICENI_LIMIT
        elif any(v in COUNTRY_ALIASES and not COUNTRY_ALIASES[v] for v in values):
            notes[rid] = "Only named countries/entities appear in filters; unspecified destinations remain in the recorded scope and are not guessed."
    assert len(country_map) == 829 and len(audit["country_repairs"]) == 48
    return country_map, display_map, notes


def accepted_rounds(programme, state):
    rounds = {}
    for entry in state["integrated_packets"]:
        cycle = entry["cycle_id"]
        directory = programme / "rounds" / cycle.removeprefix("REC50-")
        patch_path = directory / "accepted-patch.json"
        completion_path = directory / "completion.json"
        patch, completion = read(patch_path), read(completion_path)
        digest = sha(patch_path)
        assert digest == entry["sha256"], (cycle, "Integrated patch hash differs")
        assert patch["adjudication"]["status"] == "accepted", cycle
        assert patch["adjudication"].get("challenger"), cycle
        assert completion["status"] == "complete", cycle
        assert completion["accepted_patch_sha256"] == digest, cycle
        rounds[cycle] = {
            "patch": patch, "completion": completion,
            "proof": {
                "cycle_id": cycle,
                "accepted_patch_path": f"rounds/{directory.name}/accepted-patch.json",
                "accepted_patch_sha256": digest,
                "completion_path": f"rounds/{directory.name}/completion.json",
                "completion_sha256": sha(completion_path),
                "challenge_packet_sha256": patch["adjudication"]["challenge_packet_sha256"],
                "accepted_at_utc": patch["adjudication"].get("completed_at_utc"),
                "checkpoint_completed_at_utc": completion["completed_at_utc"],
            },
        }
    assert len(rounds) == 50
    return rounds


def amend(row, column, value, table, key, reason, proof, audit):
    if row.get(column) == value:
        return
    audit["field_overrides"].append({
        "table": table, "key": key, "column": column,
        "expected_old": copy.deepcopy(row.get(column)), "new_value": copy.deepcopy(value),
        "reason": reason, "accepted_review_evidence": proof,
    })
    row[column] = value


def reconcile_reviews(tables, data, rounds, audit):
    reg = row_index(tables, "Register", "ID")
    dur = row_index(tables, "Durations", "Record ID")
    initial = row_index(tables, "Audit review", "Record ID")
    phase_parent = {p["Phase ID"]: p["Parent record ID"] for p in tables["Chronology phases"]}
    states = {s["record_id"]: s for s in data["review_states"]}
    events, issued = collections.defaultdict(list), {}
    full_cycles, targeted_cycles = collections.defaultdict(list), collections.defaultdict(list)
    changed_records = collections.defaultdict(set)
    for cycle, round_data in rounds.items():
        p, proof = round_data["patch"], round_data["proof"]
        for correction in p.get("corrections", []):
            key = correction.get("key", {})
            rid = key.get("ID") or key.get("Record ID") or key.get("Parent record ID")
            rid = rid or phase_parent.get(key.get("Phase ID"))
            if rid in reg:
                changed_records[cycle].add(rid)
        for addition in p.get("additions", []):
            rid = addition["record_id"]
            events[rid].append({"cycle": cycle, "scope": "new_research", "outcome": "accepted_addition",
                                "question_id": None, "finding": "Accepted new record with its recorded evidence limits."})
        for addition in p.get("phase_additions", []):
            rid = addition["record_id"]
            events[rid].append({"cycle": cycle, "scope": "phase_addition", "outcome": "accepted_phase_addition",
                                "question_id": None, "finding": "Accepted source-led phase addition on an existing parent; no full-record audit is implied."})
        for q in p.get("record_review_questions", []):
            rid = q["record_id"]
            scope = q["review_scope"]
            events[rid].append({"cycle": cycle, "scope": scope, "outcome": q["outcome"],
                                "question_id": q["question_id"], "finding": q["finding"]})
            (full_cycles if scope == "all_current_claims_and_phases" else targeted_cycles)[rid].append(cycle)
        for issue in p.get("unresolved_issues", []):
            issued[issue["Issue ID"]] = {"issue": issue, "proof": proof}
    assert len(full_cycles) == 160 and len(targeted_cycles) == 162
    queue = tables["Unresolved queue"]
    pending_before = [q for q in queue if "pending" in
                      ((q.get("Follow-up status") or "") + " " + (q.get("Challenge outcome") or "")).lower()]
    assert len(pending_before) == 116
    reconciled_ids = set()
    workflow_pattern = re.compile(r"pending|awaiting|when available", re.I)
    status_pattern = re.compile(r"pending|awaiting|propos|original", re.I)
    for q in queue:
        workflow = bool(workflow_pattern.search(q.get("Challenge outcome") or ""))
        status = bool(status_pattern.search(q.get("Follow-up status") or ""))
        if not (workflow or status):
            continue
        assert q["Issue ID"] in issued, (q["Issue ID"], "No accepted introducing issue")
        origin = issued[q["Issue ID"]]
        for field in ["Challenge outcome", "Follow-up status"]:
            assert q.get(field) == origin["issue"].get(field), (q["Issue ID"], field, "Unexpected intervening edit")
        reason = ("The introducing patch and separate challenge were accepted and the private checkpoint completed. "
                  "Only current workflow wording is reconciled; the evidence finding, next step, priority and open status remain unresolved.")
        if workflow:
            amend(q, "Challenge outcome", "Separate AI source challenge and root adjudication completed; evidence question remains unresolved",
                  "Unresolved queue", {"Issue ID": q["Issue ID"]}, reason, origin["proof"], audit)
        if status:
            amend(q, "Follow-up status", "Open; review completed, evidence unresolved",
                  "Unresolved queue", {"Issue ID": q["Issue ID"]}, reason, origin["proof"], audit)
        reconciled_ids.add(q["Issue ID"])
    assert not any("pending" in ((q.get("Follow-up status") or "") + " " + (q.get("Challenge outcome") or "")).lower() for q in queue)
    issue_counts = collections.Counter(q["Record ID"] for q in queue)
    current = {}
    for rid in reg:
        old_outcome, old_date = reg[rid]["Current audit outcome"], dur[rid]["Review date"]
        item = {
            "record_id": rid, "outcome": old_outcome,
            "completed": old_date, "latest_cycle": states[rid].get("latest_cycle"),
            "review_scope": states[rid]["kind"], "historical_outcome": old_outcome,
            "historical_review_date": old_date, "open_issue_count": issue_counts[rid],
            "ever_full_record_audit": rid in full_cycles,
            "full_record_audit_cycles": unique(full_cycles[rid]),
            "targeted_question_cycles": unique(targeted_cycles[rid]),
            "substantive_uncertainty_retained": True,
            "latest_verification_label": "Earlier recorded reviews retained; no additional REC50 record review recorded.",
        }
        if events[rid]:
            cycle = states[rid].get("latest_cycle") or max(events[rid], key=lambda e: int(e["cycle"].split("R")[-1]))["cycle"]
            selected = [e for e in events[rid] if e["cycle"] == cycle]
            assert selected, (rid, cycle, "Latest cycle does not match accepted record events")
            round_data = rounds[cycle]
            p, proof = round_data["patch"], round_data["proof"]
            stamp = proof["accepted_at_utc"] or proof["checkpoint_completed_at_utc"]
            label = {"full_record_audit": "Full-record source audit", "targeted_review": "Targeted source review",
                     "new_research": "New-record source research"}.get(states[rid]["kind"], "Source review")
            if all(e["scope"] == "phase_addition" for e in selected):
                label = "Source-led phase addition"
                item["review_scope"] = "phase_addition"
            outcomes = unique(e["outcome"] for e in selected)
            if any(o == "correction_proposed" for o in outcomes) and rid in changed_records[cycle]:
                finding = "accepted corrections"
            elif "qualification_proposed" in outcomes:
                finding = "accepted qualification"
            elif any(o in {"unresolved", "not_retrievable"} for o in outcomes):
                finding = "completed with unresolved evidence"
            elif "accepted_addition" in outcomes:
                finding = "accepted addition"
            elif "accepted_phase_addition" in outcomes:
                finding = "accepted phase evidence"
            else:
                finding = "retained with recorded qualifications"
            readable = f"{label} ({cycle}); {finding}; evidence limits retained."
            item.update({
                "outcome": readable, "completed": stamp[:10], "completed_at_utc": stamp,
                "latest_cycle": cycle, "latest_verification_label": readable,
                "latest_question_ids": [e["question_id"] for e in selected if e["question_id"]],
                "research_outcomes_as_recorded": outcomes,
                "accepted_corrections_in_latest_cycle": rid in changed_records[cycle],
                "adjudication": p["adjudication"]["root_decision"],
                "researcher": p["adjudication"]["researcher"],
                "challenger": p["adjudication"]["challenger"],
                "provenance": "Latest accepted REC50 record event; the original research outcome and earlier native values remain historical.",
                "accepted_review_evidence": proof,
            })
            reason = "Use the latest accepted, checkpoint-complete record review as current release metadata; retain earlier values in the override audit and unchanged review history."
            amend(reg[rid], "Current audit outcome", readable, "Register", {"ID": rid}, reason, proof, audit)
            amend(initial[rid], "Current adjudicated outcome", readable, "Audit review", {"Record ID": rid}, reason, proof, audit)
            amend(dur[rid], "Review date", stamp[:10], "Durations", {"Record ID": rid}, reason, proof, audit)
        current[rid] = item
    audit["review_reconciliation"] = {
        "explicit_pending_rows_before": 116,
        "explicit_pending_rows_after": 0,
        "workflow_issue_rows_reconciled": len(reconciled_ids),
        "workflow_issue_ids": sorted(reconciled_ids),
        "additional_wording": "Also reconciles accepted original-proposal / awaiting-adjudication labels; substantive uncertainty remains unchanged.",
        "accepted_round_receipts_checked": len(rounds),
        "native_followup_history_changed": False,
    }
    return current


def method_metadata(method):
    sentences = re.split(r"(?<=\.)\s+(?=[A-Z])", method["full_text"])
    assert " ".join(sentences) == method["full_text"]
    # Keep the supplied account verbatim. Paragraph boundaries are presentational.
    paragraphs = [" ".join(sentences[:4]), " ".join(sentences[4:6]),
                  " ".join(sentences[6:9]), " ".join(sentences[9:])]
    paragraphs = [p for p in paragraphs if p]
    return {
        "full_text": method["full_text"], "public_methodology_paragraphs": paragraphs,
        "account_source": method["account_source"], "models": method["models"],
        "history": method["history"], "rec50": method["rec50"],
        "counting_notes": method["counting_notes"],
        "verification_statement": (
            "Research, source challenge and adjudication used separate contexts of the same AI model. "
            "Source access and unresolved claims remain explicit; independent human verification of every entry is not implied."
        ),
        "review_limits": (
            "The five register-wide reviews covered successive dataset versions. REC50 full-record audits cover "
            "160 distinct parents; 176 targeted questions concern 162 parents, with overlapping populations. "
            "Current/latest review kind is distinct from whether a record has ever received a full-record audit. "
            "Mechanical checks cover the complete final data but do not certify every research claim as true."
        ),
        "current_vs_historical": (
            "Current phases and accepted later decisions govern the release. Original findings, research proposals, "
            "previous workflow labels and earlier review dates remain historical; accepted review completion does not resolve every evidence gap."
        ),
        "source_url_definition": (
            "4,680 distinct recorded HTTP(S) URL strings across the complete per-record source histories, including "
            "earlier retrievals and geography references. This is not a count of independent reporting origins or full-text inspections."
        ),
    }, sentences


def prepare_reader(reader, country_display, country_notes, current, method, sentences, audit):
    model = copy.deepcopy(reader)
    index = {c["name"]: i for i, c in enumerate(model["columns"])}
    for row in model["rows"]:
        rid = row[0]
        changed = {}
        values = {"Countries / territories": country_display[rid]}
        if current[rid].get("latest_cycle"):
            values["Latest verification"] = current[rid]["latest_verification_label"]
            values["Review date"] = current[rid]["completed"]
        if rid == "C7-EU-003":
            for field in ["Crossing and scope", "Current uncertainty / qualification"]:
                existing = row[index[field]] or ""
                values[field] = existing + ("\n\n" if existing else "") + URZICENI_LIMIT
        for field, value in values.items():
            pos = index[field]
            if row[pos] != value:
                changed[field] = {"expected_old": row[pos], "new_value": value}
                row[pos] = value
        if changed:
            audit["reader_overrides"].append({"record_id": rid, "fields": changed})
    labels = ["Models used", "Initial research programme", "Separate review contexts", "Source-check questions",
              "Register-wide reviews", "Chronology follow-up", "Final 50 cycles", "Episodes and phases",
              "Final catalogue", "Consistency checks", "Review coverage limits"]
    assert len(sentences) == len(labels), ("Method sentence layout changed", len(sentences))
    methods = [reader["methods"][0], reader["methods"][1]]
    methods.extend([label, sentence] for label, sentence in zip(labels, sentences))
    retained = {label: text for label, text in reader["methods"]}
    methods.extend([[label, retained[label]] for label in
                    ["Extent of review", "Fixed source audits", "Reading dates", "Duration units", "Rationales and geography"]])
    methods.extend([
        ["What the URL count means", "There are 4,680 distinct recorded HTTP(S) URL strings, 4,997 Source index record–URL rows and 4,998 per-record URL associations. Earlier retrievals and geography references are included. Shared reports and repeat retrievals are not independent witnesses; recorded access may be full text, indexed text or failed."],
        ["Current and historical review", "The latest accepted record review supplies the current label and review date. Full-record audit and targeted-question scopes are distinct. Original proposed outcomes, previous workflow labels and earlier dates remain preserved in the review history and release override audit. A completed review can leave evidence unresolved."],
        ["Country and entity filters", "Country/entity values are normalized for filtering. Forty-eight records without a Dimensions row recover country context from recorded location or phase evidence. This does not add coordinates or approve map bindings. Broad policies retain only named entities; unspecified destinations are not invented. Urziceni retains Romania with its counterpart explicitly unresolved."],
        ["Sources and qualifications", retained["Sources and qualifications"]],
        ["Using the master", "Use the header filters for country/entity, research area or inclusion. Expand rows or use the formula bar for long text. The two visible worksheets are the master reader and this Methodology guide. The structured data companion retains native phases, source histories, review findings and geographic decisions."],
        ["Citation", retained["Citation"]], ["Credits", retained["Credits"]],
    ])
    assert max(len(text) for _, text in methods) < 1000
    model["methods"] = methods
    model["methodology_full_text"] = method["full_text"]
    model["release_method"] = method
    model["current_review_by_record"] = current
    model["countries_by_record"] = {rid: normalize_countries(tokens(value)) for rid, value in country_display.items()}
    model["country_scope_limits_by_record"] = country_notes
    model["visible_sheets"] = ["Master records", "Methodology"]
    model["subtitle"] = "829 records. 825 included. 1,010 phases. Research release: 25 October 2026."
    return model


def validate_preservation(original, adapted, old_reader, reader, audit, original_tables):
    before, after = original["tables"], adapted["tables"]
    protected_tables = ["Chronology phases", "Chronology sources", "Dimensions", "Evidence", "Follow-up review",
                        "Locations", "Phase locations", "Rationale coding", "Source index"]
    for name in protected_tables:
        assert before[name] == after[name], (name, "Research values changed")
    for name in original_tables:
        if name not in {"Register", "Audit review", "Durations", "Unresolved queue"}:
            assert original_tables[name] == after[name], (name, "Supporting history changed")
    allowed = {
        "Register": {"Current audit outcome"},
        "Audit review": {"Current adjudicated outcome"},
        "Durations": {"Review date"},
        "Unresolved queue": {"Challenge outcome", "Follow-up status"},
    }
    native_changes = 0
    for name, fields in allowed.items():
        assert len(before[name]) == len(after[name])
        for a, b in zip(before[name], after[name]):
            assert set(a) == set(b)
            for key in a:
                if a[key] != b[key]:
                    assert key in fields, (name, key, "Nonmetadata field changed")
                    native_changes += 1
    assert native_changes == len(audit["field_overrides"])
    assert original["source_urls_by_record"] == adapted["source_urls_by_record"]
    urls = {u for v in adapted["source_urls_by_record"].values() for u in v}
    assert len(urls) == 4680 and all(u.startswith(("https://", "http://")) for u in urls)
    assert len(after["Register"]) == 829 and len(after["Chronology phases"]) == 1010
    assert len({r["ID"] for r in after["Register"]}) == 829
    assert len({r["Phase ID"] for r in after["Chronology phases"]}) == 1010
    included = {r["ID"] for r in after["Register"] if r["Analysis inclusion"] == "Included"}
    assert len(included) == 825
    assert {r["ID"]: r["Analysis inclusion"] for r in before["Register"]} == {
        r["ID"]: r["Analysis inclusion"] for r in after["Register"]}
    held = [p for p in after["Chronology phases"] if p["Contested / held (1=yes)"] == 1]
    assert len(held) == 38 and all(p["Minimum date difference (days)"] is None and
                                 p["Maximum date difference (days)"] is None for p in held)
    assert old_reader["links"] == reader["links"] and len(reader["rows"]) == 829
    for a, b in zip(old_reader["rows"], reader["rows"]):
        assert a[0] == b[0]
        for i, (v, w) in enumerate(zip(a, b)):
            assert v == w or i in ({2, 3, 7, 8, 9} if a[0] == "C7-EU-003" else {2, 8, 9}), (a[0], i)
    queue = after["Unresolved queue"]
    assert len(queue) == 523 and len({r["Issue ID"] for r in queue}) == 523
    return {
        "status": "passed", "all_parent_and_phase_ids_preserved": True,
        "all_phase_fields_preserved": True, "all_duration_numbers_and_flags_preserved": True,
        "all_exclusions_preserved": True, "all_4680_url_strings_and_4998_associations_preserved": True,
        "all_native_followup_rows_preserved": True, "all_geography_and_binding_values_preserved": True,
        "queue_findings_next_steps_priorities_and_issue_ids_preserved": True,
        "native_metadata_fields_changed": native_changes, "held_phases_numeric_exclusion_checked": 38,
        "missing_dimensions_rows_not_fabricated": 48, "country_maps_complete": 829,
        "reader_source_links_preserved": True, "visible_reader_sheets": 2,
        "all_supporting_native_cells_round_trip": True,
        "no_site_build_or_publication": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--programme", type=Path, required=True)
    args = parser.parse_args()
    programme = args.programme.resolve()
    final = programme / "compact" / "outputs" / "R50"
    paths = {
        "r50_data": final / "Global_Border_Closures_Data_2016_2026.json.gz",
        "compact_state": programme / "compact/data/current-state.json.gz",
        "r50_reader_model": final / "reader-model.json",
        "r50_summary": final / "REC50_Research_Summary.json",
        "user_methods": SOURCE / "release-method.json",
    }
    input_hashes = {name: sha(path) for name, path in paths.items()}
    original, state, old_reader, summary, method = [read(paths[name]) for name in paths]
    assert hashlib.sha256(encoded(state)).hexdigest() == original["data_state_sha256"] == EXPECTED_STATE
    assert method["counts"] == {"records": 829, "included_records": 825, "phases": 1010, "distinct_recorded_urls": 4680}
    tables, preambles, actual_headers, recovered_headers = native_tables(state)
    assert len(tables) == 55
    for name, rows in original["tables"].items():
        assert rows == tables[name], (name, "R50 export differs from native state")
    original_tables = copy.deepcopy(tables)
    data = copy.deepcopy(original)
    data["tables"] = tables
    data["native_headers"] = actual_headers
    data["native_preambles"] = preambles
    data["native_sheet_order"] = state["sheet_order"]
    data["format"] = "border-closures.current-release.v1"
    data["export_schema_revision"] = 2
    audit = {
        "format": "border-closures.release-overrides.v1", "release_id": method["release_id"],
        "original_data_state_sha256": EXPECTED_STATE, "immutable_input_sha256": input_hashes,
        "authority": "User authorized the scoped current-GitHub migration, country/filter repair and review-label reconciliation; no research facts or geometry are re-adjudicated.",
        "country_aliases": COUNTRY_ALIASES, "country_repairs": [], "country_normalizations": [],
        "field_overrides": [], "reader_overrides": [],
        "authentic_header_recoveries": recovered_headers,
    }
    country_map, display_map, notes = prepare_countries(tables, data["source_urls_by_record"], old_reader, audit)
    data["countries_by_record"] = country_map
    data["country_display_by_record"] = display_map
    data["country_scope_limits_by_record"] = notes
    rounds = accepted_rounds(programme, state)
    current = reconcile_reviews(tables, data, rounds, audit)
    data["current_review_by_record"] = current
    research_method, sentences = method_metadata(method)
    reader = prepare_reader(old_reader, display_map, notes, current, method, sentences, audit)
    # The reader uses exactly the same filter arrays as the canonical input.
    reader["countries_by_record"] = copy.deepcopy(country_map)
    audit["methodology_override"] = {
        "expected_old": copy.deepcopy(original["methodology"]),
        "new_value": copy.deepcopy(reader["methods"]),
        "reason": "Add the user's complete supplied methods account verbatim, split into readable rows, while retaining essential scope/date/uncertainty guidance.",
        "source_path": "source/release-method.json", "source_sha256": input_hashes["user_methods"],
    }
    data["methodology"] = copy.deepcopy(reader["methods"])
    data["release_metadata"] = {
        "release_id": method["release_id"], "snapshot_date": method["release_date"],
        "study_window": method["study_window"], "research_method": research_method,
        "release_method": method, "distinct_recorded_urls": 4680,
        "source_index_rows": len(tables["Source index"]),
        "record_url_associations": sum(len(v) for v in data["source_urls_by_record"].values()),
        "counts": data["counts"], "review_counts": summary["review_counts"],
        "review_state_note": "The original R50 review_states list is preserved. current_review_by_record supplies reconciled release labels, including phase additions on existing parents; cumulative audit counts come from the completed ledger.",
        "full_record_review_ledger": summary["full_record_review_ledger"],
        "native_data_state_sha256": EXPECTED_STATE,
        "download_workbook": {"filename": "Global_Border_Closures_Master_2016_2026.xlsx",
                              "reader_model": "source/current-reader-model.json", "visible_sheets": 2,
                              "role": "Formatted master reader and Methodology; full native evidence is in the structured companion."},
        "table_roles": {
            name: ("current_native_research_table" if name in original["tables"] else
                   "supporting_native_codebook_or_coverage" if name in {"Codebook", "Timing coverage", "Frontier frame"} else
                   "preserved_historical_or_supporting_table_not_a_current_release_total")
            for name in tables
        },
        "preparation_limits": [
            "The original R50 research package is unchanged. Release overrides concern country filters and current review metadata only.",
            "The 48 missing Dimensions rows remain absent; separately evidenced country mappings supply filters without invented dimensions or coordinates.",
            "Urziceni has Romania only; its counterpart remains unresolved and visible in reader scope/uncertainty.",
            "Broad-policy destinations not named in retained evidence are not guessed.",
            "Original historical table totals remain labelled historical; current release totals come from current native records and the completed programme ledger.",
            "Artifact hashes are bound separately in the release manifest after workbook authoring and companion assembly.",
        ],
    }
    checks = validate_preservation(original, data, old_reader, reader, audit, original_tables)
    assert {name: sha(path) for name, path in paths.items()} == input_hashes
    output_paths = {"data": SOURCE / "current-release.json.gz", "overrides": SOURCE / "release-overrides.json",
                    "reader_model": SOURCE / "current-reader-model.json"}
    write(output_paths["overrides"], audit)
    write(output_paths["data"], data)
    write(output_paths["reader_model"], reader)
    # Round-trip the serialized files, including deterministic gzip, before handoff.
    assert read(output_paths["data"]) == data and read(output_paths["reader_model"]) == reader
    report = {
        "status": "passed", "release_id": method["release_id"], "native_data_state_sha256": EXPECTED_STATE,
        "counts": {"records": 829, "included": 825, "phases": 1010, "native_tables": 55,
                   "native_dimensions_rows": 781, "country_mappings": 829, "country_repairs": 48,
                   "country_normalization_records": len(audit["country_normalizations"]),
                   "distinct_recorded_urls": 4680, "source_index_rows": 4997, "record_url_associations": 4998,
                   "unresolved_issue_rows": 523, "unresolved_issue_parents": 353,
                   "held_phases": 38, "held_parents": 35,
                   "historical_covid_screen_candidates": len(tables["COVID screen"]),
                   "reader_methodology_rows": len(reader["methods"]),
                   "maximum_methodology_cell_characters": max(len(v) for _, v in reader["methods"])},
        "review_reconciliation": audit["review_reconciliation"],
        "metadata_changes_by_table": dict(collections.Counter(x["table"] for x in audit["field_overrides"])),
        "authentic_header_recoveries": recovered_headers,
        "reader_records_with_updated_cells": len(audit["reader_overrides"]),
        "preservation_checks": checks, "legitimate_remaining_limits": data["release_metadata"]["preparation_limits"],
        "input_sha256": input_hashes,
        "outputs": {name: {"path": str(path.relative_to(ROOT)), "sha256": sha(path), "bytes": path.stat().st_size}
                    for name, path in output_paths.items()},
        "authored_xlsx": False, "site_built": False, "committed_or_published": False,
    }
    write(SOURCE / "release-data-report.json", report)
    print(json.dumps({"status": report["status"], "counts": report["counts"],
                      "review_reconciliation": {k: v for k, v in audit["review_reconciliation"].items() if k != "workflow_issue_ids"},
                      "outputs": report["outputs"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
