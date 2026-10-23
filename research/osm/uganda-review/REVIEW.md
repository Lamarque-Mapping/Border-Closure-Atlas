# Uganda crossing review — 23 October 2026

The first review package is complete. The revised global scope is **motorways,
trunk roads and primary roads**, including link roads. Secondary and smaller
roads are included only through a sourced exception for a documented major
border post or a crossing named in the closure register. Existing smaller-road
findings are retained as background information.

The fresh scoped extraction produces **39 candidates**: 36 on main roads,
Lwakhakha as a documented major-post exception, and two unresolved alternatives
for the Busanza crossing named in the workbook. This is a manageable review
queue, not a count of 39 established crossing facilities.

The map remains line-only. No new points, event dates or closure claims have
been published, and no OSM files are loaded when the website opens.

## Main findings

| Item | Result | Meaning |
|---|---:|---|
| Fresh main-road extraction, with exceptions | 39 candidates | Geometric contacts requiring source and route review |
| Original major-road candidates assessed | 76 | The earlier scope included all secondary roads |
| Named crossing/service-point reference entries | 49 | A non-exhaustive source benchmark, including background entries |
| Supported reference-to-route correspondences | 16 | 14 belong to the original major-road sample; two are smaller-road background findings |
| Provisional reference correspondences | 17 | Identity, exact route or location still needs resolution |
| References without an accepted location match | 16 | Not evidence that the crossing is absent from OSM |
| Event–crossing identities supported by reporting | 8 links | Six workbook records and six distinct named crossings |
| Event links with supported OSM correspondence | 6 links | Four distinct crossings; coordinates are not surveyed |
| Event links with unresolved exact road contact | 2 links | Malaba and Busanza |
| Old name-based assignments retired | 33 of 38 | Five remain proposals with separately reviewed evidence |

The 49 entries include formal posts, informal crossings and service-point
references of uncertain transport mode. They are not a denominator of 49
verified, currently operational road crossings. The source register resolves
regional aliases into 36 unique document URLs, including closure reporting;
multiple URLs do not necessarily represent independent witnesses.

## What changed in the extraction

- The default road scope is now limited to main roads. A source-backed list
  controls targeted exceptions; proximity does not add smaller roads automatically.
- Nearby town names produce discovery suggestions only. They cannot create
  accepted event-location links. Accepted identities require separate sources,
  country pair, transport mode and relevant workbook phase IDs.
- Adjacent access-restricted tracks are kept apart from main roads. At Malaba,
  the new main-road run retains the trunk bridge and excludes the private track
  that the exploratory grouping had combined with it.
- The recorded representative is now the actual 75 m grouping anchor. Every
  raw contact coordinate, route ID and boundary ID is retained.
- Existing extraction outputs are protected against accidental replacement.
  Stable crossing IDs belong to the reviewed directory; extraction IDs remain
  snapshot-specific, with explicit lineage between versions.

## Geometry review

The original 436 boundary ways form a closed Uganda polygon. The review
reconstructs all 843 original candidate IDs and all 1,046 raw contacts. It
follows connected roads using shared OSM node IDs, with road and rail kept
separate. It tests sustained continuation into both mapped country interiors
instead of relying on a few metres immediately around an intersection.

For the original 76 major-road candidates, 41 have a sustained geometric
transition, 33 require boundary-alignment or repeated-contact review, and two
remain unresolved under the continuation test. These are geometry diagnostics,
not legal or operational classifications.

One Yei–Koboko/A8 way accounts for 19 contacts along the Uganda–DRC boundary.
All 19 are flagged. Conservative corridor grouping reduces them to nine review
units, but does not establish nine crossings. Genuine departures from the
boundary band are kept apart; merely enlarging a clustering radius would hide
this distinction.

The focused 39-candidate queue contains:

| Review outcome | Candidates |
|---|---:|
| Supported named reference correspondence | 14 |
| Boundary alignment / repeated contacts | 19 |
| Named reference with unresolved exact geometry | 5 |
| Other unverified geometric connection | 1 |

The complete [geometry methods](topology-method.md) record the 30 m screening
band, 100 m sustained-side run, 1 km trace limit, branch handling and limitations.
Those distances are test parameters, not measured positional accuracy.

## Consequential corrections and remaining questions

**Elegu–Nimule:** the original name search selected another settlement called
Elegu roughly 30 km west of the crossing named in the reporting. The source
review identifies the Amuru–Nimule road corridor. The published UNHCR reference
point and the named A43 bridge support the new correspondence.

**Busanza–Kitagoma:** published references locate the crossing in Kisoro.
Earlier suggestions near Ishasha and Bunagana were driven by homonymous
settlements. Two plausible road contacts remain close to the published point;
the exact gate has not been selected. It stays a bounded workbook exception.

**Malaba:** the truck-related event is linked to the named road crossing only.
The adjacent railway has no accepted link to that event. The fresh extraction
separates the trunk bridge from the private track, but precise historical gate
or lane use remains unverified.

**Bugango:** the UNHCR point and major-road candidate are about 11 km apart.
The reference remains unresolved and outside automatic main-road extraction.

**Some northern service points:** published points lie close to mapped roads
but several kilometres from the generated boundary contacts. A service facility,
road corridor and exact frontier crossing are different geographic objects.
They are not silently snapped together.

**An operational-source conflict:** the July 2022 Elegu article reports stopped
customs clearance through anonymous sources, while a named Ugandan military
spokesperson says the Ugandan border remained operational. The event’s crossing
identity is supported; that disagreement is retained. This package does not
re-adjudicate the authoritative workbook’s chronology.

## Event and phase preservation

| Workbook record | Named crossing identity | Spatial correspondence |
|---|---|---|
| GL01 | Katuna / Gatuna | Supported corridor reference |
| GL12 | Bunagana | Supported corridor reference |
| GL13 | Bunagana; Ishasha | Supported corridor references |
| GL13 | Busanza / Kitagoma | Exact road contact unresolved |
| R3-AF-006 | Elegu / Nimule | Supported corridor reference |
| R3-AF-007 | Elegu / Nimule | Supported corridor reference; operational-source conflict retained |
| R4-AES-002 | Malaba road | Named road crossing supported; exact contact remains qualified |

Busanza retains phase GL13-R1. Bunagana and Ishasha retain GL13-D1; they do not
inherit each other’s reopening or permission dates. The two national COVID
records are not expanded into assumed closures at every mapped post.

## Limits and scaling decision

The source review used government immigration/customs material, institutional
transport references, UNHCR data and substantive closure reporting. This was
AI-assisted desk research with cross-checks, not fieldwork or independent human
validation. UNHCR’s 20 May 2021 date is its publication date. Per-point survey
dates, coordinate accuracy, collection method and upstream independence from
OSM are unspecified and remain unknown.

The full candidate list still contains unknown cases, so neither global
precision nor complete crossing recall can honestly be calculated. Report
supported, provisional and unlocated references by frontier, with their source
dates. Do not interpret an unsearched or unlocated site as open.

The next scaling gate is to test **the main-road method** on contrasting
frontiers, resolve systematic geometric failures, and retain a small, explicit
exception list. There is no systematic smaller-road research programme in the
current scope. All spatial processing remains offline, with only compact
reviewed assets eligible for eventual publication.

## Files

- [Main-road priority review](main-road-priority-review.csv): the scoped 39-candidate review queue.
- [Crossing directory](crossing-register.csv): 49 reference entries, evidence, coordinates and status.
- [Event–crossing links](event-crossing-links.csv): eight sourced identity links with their phase scope.
- [Original 76-candidate audit](major-road-review.csv): complete assessment of the earlier major-road sample.
- [Retired name assignments](retired-name-assignments.csv): all 33 rejected event-point assignments and reasons.
- [Source index](source-index.json): documents, regional aliases and specific supporting claims.
- [Scope policy](scope-policy.json): main-road classes and the two bounded exceptions.

Machine-readable tables, GeoJSON, raw contacts, retained graph evidence and
source/input checksums accompany these files. The original pilot is frozen.
Tests cover source and phase integrity, false place-name links, transport-mode
separation, connected-road geometry, repeat contacts, access-restricted tracks,
main-road filtering and the unchanged closure workbook/map.

OSM-derived coordinates and graph data: © OpenStreetMap contributors, ODbL 1.0.
UNHCR external reference data: CC BY 4.0 unless otherwise specified by its source.
