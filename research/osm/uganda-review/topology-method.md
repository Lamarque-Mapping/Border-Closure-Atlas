# Uganda topology review

This is an automated geometric review of the frozen pilot, not a verified
inventory of legal, operational or historically affected border crossings.
The authoritative closure workbook and the website remain separate.

## Reproduce

Use the pinned environment from `scripts/requirements-osm.txt`.

```sh
python scripts/osm-review-topology.py --pbf /path/to/original/uganda.osm.pbf
python scripts/verify-osm-topology.py
```

The script checks the PBF checksum against the original pilot before creating
`topology-graph-context.json.gz`. Subsequent runs can omit `--pbf` and use that
saved context. `--rebuild-context` recreates it from the checked PBF. The context
retains OSM node IDs, way IDs, versions, timestamps, coordinates and tags.
No live requests occur during review. Default paths are repository-relative.

## Exact audit trail

The 436 boundary ways form one closed Uganda polygon. All 1,046 original raw
road, rail and ferry contacts are reconstructed from the same geometries, and
the original clustering is replayed. The script checks every original
candidate hash and group size, preserving all 843 original candidate IDs.

This matters because the pilot searched within 75 m of one anchor but stored
the first spatial-index result as its displayed coordinate. Some members can
therefore be more than 75 m from the displayed coordinate. Reassigning raw
contacts to whichever displayed point is nearest would change the evidence.
The review replays the original grouping instead. Those old groups can also
contain distinct nearby roads: each raw route member is evaluated separately.

## Country-side continuation

The graph includes complete transport ways within 1.5 km of the frontier,
selected from the original PBF. Connections require the same OSM node ID and
the same transport mode. Colocated coordinates are insufficient. Road, rail
and ferry graphs remain separate.

Each raw contact is traced in both directions along its source way. At way
endpoints, a shared road reference or name guides continuation. Otherwise,
alternative connected branches are explored and must agree before a side is
accepted. Loops, incomplete ways, unresolved forks and trace limits remain
qualified. Access tags are preserved; geometric connectivity does not grant
permission to use a route.

The default review parameters are:

| Parameter | Value |
|---|---:|
| Boundary uncertainty band | 30 m |
| Maximum regular sampling interval | 20 m, with original vertices also sampled |
| Required uninterrupted clear-side run | 100 m |
| Maximum trace in either direction | 1,000 m |
| Maximum branch expansion | 12 |
| Repeated-contact warning | At least 3 original candidates on one way within 5 km |

These are transparent screening choices, not estimates of OSM positional
accuracy. Results use OSM's boundary geometry, which can itself be inaccurate
or contested. A side outside Uganda does not independently identify the
neighbouring jurisdiction near a tripoint.

## Review classifications

- `sustained_country_transition`: at least one member has unambiguous continued
  geometry on opposite sides, without a repeated-contact or same-country-return
  warning. This remains a physical connection candidate.
- `boundary_alignment_or_repeated_contacts`: the way repeatedly meets the
  boundary, remains within the uncertainty band between candidates, or returns
  to the same country at a meaningful distance. Some members can also have a
  geometric transition; that does not resolve facility identity.
- `tangent_or_endpoint`: a previously identified touch/end contact has no
  sustained transition in the new graph.
- `unresolved`: the required continuation or country-pair evidence is missing
  or ambiguous.

## Corridor review groups

Two original candidates are grouped for review only when they share the same
OSM way, transport mode and country pair, and the intervening route remains
inside the 30 m boundary band. Regular samples and every original vertex are
checked. An excursion into clear country territory keeps the contacts apart.
Nearby separate roads are never merged merely by distance. The group IDs are
snapshot review IDs, not permanent IDs for verified crossings.

These groups organize inspection; their count must not be reported as a count
of crossings or used in closure totals. All outputs explicitly retain
`is_verified_crossing: false` and `is_closure_evidence: false` where applicable.

## Files

- `topology-diagnostics.json`: one row for each of the 843 frozen candidates,
  including its category, raw-contact IDs, group ID and review flags.
- `topology-contacts.json`: every original coordinate and its source route and
  boundary IDs, with both directional graph traces and their stopping reasons.
- `topology-review-groups.json`: candidate membership and explicit corridor
  edges; every original candidate appears in exactly one review unit.
- `topology-major-road-review.csv`: the 76 major-road candidates for review.
- `topology-summary.json`: source hashes, parameters, counts and limitations.
- `topology-graph-context.json.gz`: reproducible connected-route evidence.
- `topology-overlaps.json`: any intersecting line geometries held apart.

This run diagnoses the original candidates. It does not discover crossings
missing from the pilot, establish an exhaustive benchmark, or replace source
verification. Countrywide, antimeridian and disputed-frontier processing need
further validation before global expansion.

Reference geometry: © OpenStreetMap contributors, ODbL 1.0. The derived
geographic review data retain the original pilot's attribution and licence.
