# OSM crossing reference research

This directory contains reviewed main-road reference research across Uganda's
frontiers, Kenya–Tanzania, France–Germany, US–Mexico and Kenya–Somalia. It is
separate from the closure register and is not loaded by the website. The map
continues to display lines only. OSM features establish present-day reference
geography, not whether a particular historical closure affected a crossing.

## Current scope and reviewed outputs

The global extraction now defaults to **motorways, trunk roads and primary
roads, including links**. Secondary and smaller roads enter only through an
explicit, sourced exception for a documented major post or a crossing named in
the closure workbook. Existing smaller-road findings are background data, not
an instruction to catalogue that network worldwide. Rail and ferry extraction
are opt-in. Road classifications are screening categories, not traffic counts.

Start with [the international review](international-review/REVIEW.md),
[combined named-reference directory](crossing-directory.csv),
[coverage by frontier](international-review/coverage-by-frontier.csv), and
[unresolved reference queue](unresolved-crossing-references.csv). The directory
retains provisional and background entries; it is not a census of verified gates.
The [workbook batch queue](international-review/frontier-queue.csv) preserves
all 697 included replacement-workbook records, their ten-category rationale coding, and current location/phase qualifications. It ranks reference contexts without inventing facility links. The geometry reviews retain their historical source hashes; their earlier event links are historical and have not been approved for this replacement register.

For the frozen Uganda work, see [the completed review](uganda-review/REVIEW.md),
[main-road priority table](uganda-review/main-road-priority-review.csv),
[crossing directory](uganda-review/crossing-register.csv), and
[event–crossing evidence links](uganda-review/event-crossing-links.csv).
`uganda-review/scope-policy.json` records the scope and its two targeted Uganda
exceptions. `main-road-extraction/` contains the fresh 39-candidate scoped run.
These remain candidates, including repeated contacts requiring review.

The reviewed directory has stable crossing IDs. Original and fresh extraction
IDs are snapshot IDs; `focused-extraction-lineage.json` records their raw-geometry
relationship. Name suggestions cannot automatically create event links.

`uganda-pilot/` is the frozen original exploratory extraction. Its 843 candidates,
76 major-road candidates and old name suggestions are retained for the audit
trail. They are superseded for research use by the explicit review outcomes,
not overwritten. The original broad scope included secondary and minor roads.

## Outputs

- `uganda-pilot/crossing-candidates.geojson`: grouped road, rail and ferry contacts,
  plus nearby tagged controls without an intersecting transport feature.
- `uganda-pilot/crossing-candidates.csv`: the same candidates in a review table.
- `uganda-pilot/major-road-candidates.csv`: motorway, trunk, primary and secondary
  road candidates, including link roads, for the first review pass.
- `uganda-pilot/workbook-location-audit.csv`: the historical 649 included records from the superseded workbook,
  their original crossing descriptions, retained point references and provisional
  name matches within the pilot.
- `uganda-pilot/osm-reference-evidence.geojson.gz`: source feature geometries,
  OSM IDs, versions, timestamps, tags and links for independent inspection.
- `uganda-pilot/osm-country-relations.json`: the country boundary memberships
  used by the extract. Names describe OSM relations, not an adjudication of claims.
- `uganda-pilot/boundary-overlaps.json`: routes following a boundary, excluded
  from the point-intersection candidate list.
- `uganda-pilot/summary.json`: source checksum, OSM date, workbook checksum,
  processing parameters, coverage counts and limitations.

## Current pair-specific method

1. Select the actual shared member ways of the two country boundary relations.
   Audit expected, loaded, missing, incomplete and unsupported nested members.
   Missing geometry fails by default; partial runs require explicit opt-in and
   retain that qualification. Blank-ISO bilateral relations remain provenance,
   not invented third countries.
2. Screen motorway, trunk, primary and link roads, plus individually sourced
   exceptions. Keep nearby roads as graph context without promoting them into
   global candidate scope. Intersect original coordinates and retain each raw
   road/border contact and exact OSM node IDs.
3. Review the route on both sides using actual shared-node connectivity. A
   regional metric projection supports distance tests. Stable departure needs
   100 metres outside a 30-metre boundary band, within a 1-km trace. Explore
   connected same-mode branches even when road references change at the border.
   Branches, endpoints, tangencies and boundary-following geometry remain
   qualified. This is a geometry test, not proof of a legal crossing.
4. Compare bounded named-reference samples with primary documents, road and
   bridge identities, shared-node approaches and qualified external coordinates.
   Record support for corridor identity separately from precise gate geometry.
   Nearby towns and nearest-point distances never establish identity by themselves.
5. Preserve source and code hashes, source dates, evidence, review decisions and
   unresolved cases. A new snapshot requires renewed identity review. Historical
   event links require their own evidence and are never generated automatically.

The guarded regional projection rejects antimeridian, polar and oversized
frontiers; those need a separate partitioned extraction design. Loading every
selected OSM member does not prove the boundary or crossing inventory complete.

## Archived exploratory method

1. Download a regional OSM PBF extract. Find country boundary relations tagged
   `boundary=administrative`, `admin_level=2`, and the requested country code.
   Use their member ways, including untagged ways; omit maritime ways.
2. Intersect those boundaries with motorway, trunk, primary and secondary roads,
   including links. Keep tertiary roads, residential/service roads, unclassified
   roads and tracks in a separate `other` road tier. Rail and ferry contacts
   have separate modes. Pedestrian paths are outside this pilot.
3. Intersect original coordinates first, then use a local metric projection for
   distances. Group contacts within 75 metres of an anchor, only within the same
   transport mode and OSM country pair. Preserve all contributing route and
   boundary IDs. This groups lanes and split ways without chaining a group along
   a whole border. Linear overlaps are held separately; endpoint and tangent
   contacts receive a review flag.
4. Collect `barrier=border_control` and `amenity=customs` objects within 3 km of
   a boundary. Record controls within 1.5 km of a candidate as proximity matches,
   not verified identities. Retain unmatched controls separately. This spatial
   screen does not prove that a customs facility serves a road crossing.
5. Retain up to five nearby named city/town/village/hamlet nodes within 10 km,
   including the nearest town or city even where several villages lie closer.
   Settlement names and distances remain separate from checkpoint names.
   Neither is promoted to an official crossing name.
6. The original extraction compared exact, accent-normalised locality or checkpoint names with the
   workbook's original crossing field, requiring the study country and, where
   both are known, the country pair to appear in the record. These are
   provisional name matches, not event-location joins. The current extractor
   writes these solely as `workbook_name_suggestions`, with automatic acceptance
   disabled; `workbook_candidate_links` is empty. Reviewed links live separately.
   Check the transport mode, both sides of the frontier, chronology, direction
   and affected movement before accepting a link. Broad records may name several
   crossings. An adjacent rail crossing can match the same town as a road event.

All candidates explicitly carry `is_verified_crossing: false` and
`is_closure_evidence: false`. A major road intersecting a boundary can still be a
cartographic artefact, a closed/disused route, an informal crossing, or a point
where traffic does not legally cross. OSM access tags are retained. Nearby
controls may be associated with several candidates; do not count these matches
as distinct facilities. An empty result does not establish absence.

## Reproduce the review or run a new scoped extraction

Use Python 3.12 with the pinned packages in `scripts/requirements-osm.txt`.
Keep the large downloaded PBF outside the repository; the selected evidence
and download checksum are retained here. Replace `EXTRACT` with an actual local
path. `latest` URLs change; check the download hash and OSM timestamp when
comparing runs.

```sh
python -m pip install -r scripts/requirements-osm.txt
python scripts/fetch-osm-extract.py https://download.geofabrik.de/africa/uganda-latest.osm.pbf EXTRACT.osm.pbf
python scripts/verify-osm.py
python scripts/osm-review-topology.py
python scripts/verify-osm-topology.py
python scripts/build-osm-review.py
python scripts/verify-osm-review.py
python scripts/osm-crossings.py --pbf EXTRACT.osm.pbf --country-code UG --download-manifest EXTRACT.osm.download.json --road-exceptions research/osm/uganda-review/road-exceptions.json --output NEW_SNAPSHOT_DIRECTORY
```

The topology review can reproduce the frozen pilot using its saved graph
context; no download is needed for that step. Rebuilding graph context from a
PBF requires the original checksum. A newly downloaded `latest` extract may
differ and must be a separate snapshot. Do not overwrite the frozen pilot.

The extractor defaults to `--road-scope main`. `--road-scope major` adds all
secondary roads; `--road-scope all --include-nonroad` restores the broader
exploratory scope only when deliberately requested. Existing extraction outputs
are protected unless `--allow-overwrite` is explicitly supplied. Targeted road
exceptions need a reason and source URLs, and their OSM IDs need review when
the snapshot changes. Current clustering keeps access-restricted routes apart
and stores the actual grouping anchor and every raw contact coordinate.

## Repeatable international batches

The reviewed batch manifest pins four source snapshots and their explicit
exceptions. PBFs remain outside the repository. The batch runner performs no
network requests, checks all selected source hashes before writing, reuses only
matching extraction identities and reruns topology from retained graph context.
A changed snapshot or exception set requires a new extraction directory.

```sh
python scripts/run-osm-batch.py --manifest research/osm/international-review/batch-manifest.json --cache /absolute/path/to/osm-cache --validate-only
python scripts/run-osm-batch.py --manifest research/osm/international-review/batch-manifest.json --cache /absolute/path/to/osm-cache --pair KE-TZ
python scripts/build-osm-international-review.py
python scripts/build-osm-frontier-queue.py
python scripts/verify-osm-international-review.py
python scripts/verify-osm-frontier-queue.py
python scripts/verify-osm-batch.py
python scripts/verify-osm-regional-extractor.py
python scripts/verify-osm-regional-topology.py
```

Curated association decisions are deliberately not regenerated automatically
from a new snapshot. Refresh their evidence and hashes after a new extraction
or topology run before combining outputs. The verifier rejects stale decisions.
For exact replay, retain the producing script revision as well as the PBF hash.

Use suitable regional bulk extracts, joining adjacent regions only after
checking snapshot identity and duplicate OSM payloads. The checked merger
accepts `python scripts/merge-osm-extracts.py FIRST.osm.pbf SECOND.osm.pbf
--output NEW.osm.pbf`; keep each adjacent `.osm.download.json` manifest.
`python scripts/verify-osm-merge.py` checks conflicts, provenance and cleanup. Do not scale through
repeated public Overpass bounding-box queries. The first regional expansion is
Kenya–Somalia; subsequent workbook frontiers are ranked in the batch queue.
Their queue counts are contextual records, not identified crossing facilities.

## Sources and licence

Reference geometries: © OpenStreetMap contributors, ODbL 1.0.
The derived candidate database and selected OSM evidence are offered under ODbL
1.0; attribution must accompany redistribution. The research workbook remains a
separate source, and no OSM candidate changes its findings.

- [OSM copyright and licence](https://www.openstreetmap.org/copyright)
- [Geofabrik regional extracts](https://download.geofabrik.de/)
- [Country boundary tagging](https://wiki.openstreetmap.org/wiki/Tag:admin_level=2)
- [Border-control tagging](https://wiki.openstreetmap.org/wiki/Tag:barrier=border_control)
- [Public Overpass use](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
