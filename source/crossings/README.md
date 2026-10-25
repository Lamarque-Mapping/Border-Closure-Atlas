# Phase-specific crossing geography

This map layer is separate from the historical dataset. It changes which geometry is displayed, without editing event dates, rationales, durations, evidence or Analysis inclusion.

## Files and update procedure

- `scope-review.json`: one geographical-scope decision for each included dated phase, plus the two undated records. The initial classification is a conservative reading of the recorded phase scope, not a new adjudication of historical evidence.
- `locations.json`: sourced crossing-area positions and individually reviewed phase bindings. Source versions, coordinate methods, qualifications and unresolved or rejected matches are retained.
- `release-reconciliation.json`: explicit decisions for the added phases, preserved-review provenance, and any new applicability bindings to previously sourced crossing positions. No new coordinates are introduced by the REC50 release reconciliation.
- `scripts/reconcile-release-geography.py`: the reviewed, explicit reconciliation of the preserved geography with the final native source; run before binding a new release manifest.
- `scripts/build-crossing-geography.cjs`: validates these files and produces `dist/crossing-geography.js` plus the downloadable location review.
- `scripts/verify-crossing-map.cjs`: verifies phase mapping, release identity, evidence preservation, timeline populations, geometry types and export behaviour.

Run the builder and crossing checks whenever this layer changes. A replacement native dataset needs its own phase-scope review; the builder checks every included phase, each exact current scope string, location/scope input identities and source-bound positions. The runtime rejects a source hash mismatch rather than silently applying old bindings. The readable workbook has its own independent download fingerprint.

## Map rules

A single identified crossing uses one point. Several identified crossings can use separate points; mark a multi-site phase complete only when its full named site set has been mapped. Wider rules can use the existing border references, with the established solid/dotted extent distinction. Uncertain scope and unlocated crossings receive no inferred geometry. They remain in search, counts, full records, Analysis and CSV downloads. Never fall back from an unlocated post to a whole-border highlight.

An explicit `complete: false` binding takes precedence over any complete binding. This also applies to a named crossing whose wider approach or informal routes remain unlocated. A sourced point is not an approval of every phase date, and held phases remain held.

Bindings apply to active dated phases. A point must not inherit unrelated national phases or the full parent record's chronology. A last-confirmed observation is not extended to today; contested dates remain observations at their recorded dates.

## Positional limits

Positions identify approximate crossing areas, not exact historical gates or barrier footprints. Source-backed road controls, customs facilities, bridge references and published AU-PIDA crossing markers can be used with their precision explained. A nearby town or road intersection alone does not prove a crossing identity. Do not merge adjacent road/rail facilities, opposite-direction terminals or approach blockades without evidence.

The preserved coordinates and old workbook geography are not automatically approved current event links. The separate rejected/unverified bindings remain excluded unless a later explicit review resolves them. OSM describes reference geography, not the historical occurrence or duration of a closure.

A crossing uses exactly one mark from the existing dotted border style: a 1-pixel round-capped stroke, 2.7 pixels thick (3.7 × 2.7 pixels overall). Zoom, record count and duration do not enlarge it. The normal point has no extra outline; selection adds a temporary halo. Invisible 44-pixel controls support touch and keyboard use. The map and PNG export use the same colour palette and phase bindings.
