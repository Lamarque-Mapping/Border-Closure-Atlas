# First OSM crossing pilot

The line-only atlas is live. All 14 original point references and their links to
52 included records are retained in the research data. The OSM work below is a
separate reference dataset and does not add points to the map or alter closure
records.

The pilot processed a Geofabrik Uganda extract with OSM data dated 21 October
2026. It covers Uganda's borders with Kenya, South Sudan, the Democratic Republic
of the Congo, Rwanda and Tanzania. All 436 boundary ways referenced by Uganda's
country relation were present in this extract.

| Result | Count | Meaning |
|---|---:|---|
| Major-road candidates | 76 | Motorway, trunk, primary or secondary road contacts, including links |
| All road candidates | 841 | Includes minor roads and tracks; not a count of official crossings |
| Rail / ferry candidates | 1 / 1 | Kept as separate transport modes |
| Nearby tagged control objects | 26 | OSM checkpoint/customs objects; several may serve one crossing |
| Workbook records with provisional name matches | 6 | Candidate associations requiring review of location and scope |

The six records are GL01, GL12, GL13, R3-AF-006, R3-AF-007 and R4-AES-002.
The full workbook audit also preserves crossing descriptions for all 649 included
records, including those outside this pilot. It does not treat every crossing
description as a distinct named post.

## First leads to check

| Workbook name | OSM candidate | What needs checking |
|---|---|---|
| Malaba | `osm-ea97afe8b2c493b9` — trunk road A109 and a nearby track | The same town also matches a rail crossing. One grouped route has an access restriction; that tag does not establish a historical closure. |
| Katuna | `osm-60accc5e3da83ba8` — trunk road NR3 | Match the record's affected direction and movement to the road crossing. |
| Bunagana | `osm-2e13392e3235206d` — primary-road contact | The nearest settlement label is Gatsibo; Bunagana is a separate nearby place. Confirm the actual post before naming the point. |
| Ishasha / Busanza | `osm-0442cf6b8cc3dfae` — primary-road contact | Both names occur in the nearby-place search and the same broad record. The routine does not choose between them. |

Every candidate remains explicitly unverified. The geometric checks flag eight
endpoint or tangent contacts and two groups containing an OSM access restriction.
Synthetic tests cover parallel lanes, split road segments, tangent contacts,
roads following the border, country pairs and the separation of reference data
from closure evidence.

This supports using OSM to generate a review queue. It does not support displaying
all intersections as closed border posts. The next useful step is to validate the
76 major-road candidates against named facilities and the workbook's sources,
then apply the same process to other regional extracts. Smaller roads can be
reviewed separately. The public map can remain line-only throughout.

Download the compact review table in `major-road-candidates.csv`; the complete
geometry is in `crossing-candidates.geojson`. Source OSM IDs, versions, timestamps,
tags and geometries are retained in `osm-reference-evidence.geojson.gz`. The
pipeline, source links and reproduction instructions are in the parent README.

Reference data: © OpenStreetMap contributors, ODbL 1.0, supplied by Geofabrik.
