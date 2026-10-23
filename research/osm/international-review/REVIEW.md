# Main-road crossing reference review

The road extraction and geometry review below are a historical snapshot from 23 October 2026, retained with their original workbook hashes. Their earlier event associations have not been approved for the replacement register. The current workbook queue is described separately below.

This package completes the three contrasting-frontier tests and starts workbook-led regional expansion with Kenya–Somalia. It adds a reusable extraction, topology and batch workflow, a combined named-reference directory, a coverage table and explicit review queues. The atlas still displays closure lines only. No new closure events or event-to-crossing links were created.

## Scope and result

The global road screen is **motorway, trunk and primary, including links**. Smaller roads enter only through a listed, sourced exception for a named workbook crossing or documented major post. Other nearby roads are retained as connectivity context. Road class is a screening device, not a measure of traffic or strategic importance.

| Frontier | Candidate groups | Raw road/border contacts | Named references reviewed | Supported corridor identities | Provisional | Outside scope |
|---|---:|---:|---:|---:|---:|---:|
| Kenya–Tanzania | 6 | 9 | 7 | 4 | 1 | 2 |
| France–Germany | 21 | 39 | 11 | 11 | 0 | 0 |
| US–Mexico | 50 | 258 | 27 | 27 | 0 | 0 |
| Kenya–Somalia | 4 | 4 | 4 | 2 | 2 | 0 |
| **This round** | **81** | **310** | **49** | **44** | **3** | **2** |

Candidate groups are not facilities. Several lanes or separate cargo/passenger approaches may belong to one named corridor. Conversely, a single closure record may cover several crossings or an entire policy geography. The bounded source samples do not establish global precision, recall or completeness.

The combined [directory](../crossing-directory.csv) retains the earlier 49 Uganda references: **98 named references, comprising 60 supported corridor identities, 20 provisional, 16 not recovered and two outside the present scope**. It includes historical background and smaller-road references retained from Uganda; 98 is not a count of verified major-road gates. The [unresolved reference list](../unresolved-crossing-references.csv) contains 55 entries, including 17 source-supported identities whose geometry still needs review. Existing Uganda evidence links remain separate and unchanged; this round added none.

## What the tests established

**Kenya–Tanzania.** The four core corridors are Namanga, Lunga Lunga/Horohoro, Taveta/Holili and Isebania/Sirari. Taveta's split approaches remain one corridor. Loitokitok/Tarakea is provisional. Muhuru Bay and Sand River Gate are retained as background rather than promoted into the main-road sample. External points are qualified references, not surveyed gate coordinates.

**France–Germany.** Eleven named corridors were matched using official crossing or bridge documents, route identities, multilingual bridge tags and actual shared OSM nodes. The three strategic tests were already tagged primary at the frontier, so no smaller-road exception was needed. Ten other extracted candidates lie outside this bounded reference sample; that does not make them false positives. A bilateral boundary relation without an ISO country code is retained as provenance rather than counted as a third country. The two relevant workbook policy records do not justify individual bridge-level event links.

**US–Mexico.** Twenty-seven named corridor references use 36 candidate groups; three additional components remain provisional and 11 groups are outside the sample. Otay Mesa's commercial gates demonstrate a real limitation of road-class-only screening: seven explicitly sourced secondary, secondary-link and service ways add two cargo groups to the retained passenger component. This is one documented-post exception, not permission to extract all service roads. Government GIS points and administrative port names were checked with their limitations; umbrella ports, individual bridges, pedestrian facilities and road gates were not treated as interchangeable. Coordinate conflicts were retained or withheld rather than silently resolved by nearest distance.

**Kenya–Somalia.** The first regional expansion targets workbook-named crossings. The main-road baseline found Liboi. Three specific exception ways add Mandera, Elwak and the E865 corridor near Ishakani/Ras Kamboni. Mandera and Liboi have supported corridor identities; Elwak and Kiunga remain provisional. Mandera's external reference point is about 3.565 km from the selected contact, so its stronger route/node evidence supports corridor identity without claiming the external point verifies a precise gate. Doolow is on the Ethiopia–Somalia frontier and was excluded from this pair.

## Geometry remains a separate decision

| Frontier | Sustained geometric transitions | Unresolved candidate groups |
|---|---:|---:|
| Kenya–Tanzania | 0 | 6 |
| France–Germany | 14 | 7 |
| US–Mexico | 28 | 22 |
| Kenya–Somalia | 2 | 2 |
| **Total** | **44** | **37** |

These are conservative geometry outcomes, not counts of operating crossings. The current reviewer follows all actual shared-node continuations, including interior junctions and changed road references. It requires 100 metres continuously beyond a 30-metre boundary band within a 1-km trace. Facility loops, alternative branches, trace limits and frontier endpoints can leave a genuine, named crossing unresolved. Kenya–Tanzania exposes this limitation particularly clearly: the sources support four core corridor identities even though all six candidate groups need path-level review. An unresolved result does not mean a road fails to cross.

The Santa Teresa test exposed why following only an unchanged road reference is unsafe: a same-reference return branch could hide the international continuation under a different reference. The reviewer now explores both. Fresh unresolved contacts cannot become a final tangent diagnosis merely because the initial intersection carried an endpoint flag. The frozen Uganda method and results remain unchanged and are identified separately.

The [geometry queue](geometry-review-queue.csv) has 47 candidate groups requiring topology or identity review. It includes candidates outside the reviewed source sample. It deliberately does not collapse every nearby contact into a presumed facility.

## Workbook coverage and expansion queue

The current queue was rebuilt from the replacement workbook (`f96ad671372e6fb9c1afd564373d954c717f4bf809b75a757b48f54ee08ca024`). It accounts for all **697 included workbook records exactly once**: 417 have one frontier context, 170 have several and 110 have unresolved or nonbilateral geography. The 276 reference contexts create 1,069 overlapping record-context associations. These are current atlas reference-line links, not approved phase geometry or closure extents; the queue does not add country pairs.

There are **682 nonempty crossing-description fields**, preserved verbatim with the workbook's location and phase qualifications and all ten current rationale categories. They are whole strings, not distinct crossings. Priority uses the replacement Locations sheet's name/marker precision; neither extracted names nor historical OSM matches establish a facility identity or phase binding. The 280 records without a single assigned frontier remain in the review queue.

Nine historical frontier batches have qualified desk-review status; seven match contexts in this replacement queue. The other 269 current contexts have no recorded batch. Historical extraction and review status do not validate event links for the new workbook. The eight earlier Uganda event links are retained only as `historical_event_link_ids`; current `accepted_event_link_ids` are empty throughout the combined directory.

The next ranked frontier contexts are:

| Frontier | Contextual workbook records |
|---|---:|
| Afghanistan–Pakistan | 20 |
| Mexico–United States of America | 19 |
| China–Vietnam | 12 |
| Libya–Tunisia | 11 |
| Ethiopia–Sudan | 12 |
| Myanmar–Thailand | 14 |

The practical next work is to resolve the 17 supported identities with pending geometry using documented through-routes and lane components, while applying the same main-road screen to the next ranked frontier batches. Each new event-location link still needs evidence for the affected movement, date and extent. A current road intersection alone cannot supply that evidence. Keep points hidden until the intended publication threshold is defined and met.

## Reproduction and audit

See [the workflow README](../README.md), [batch manifest](batch-manifest.json), [coverage table](coverage-by-frontier.csv), [frontier queue](frontier-queue.csv), [source index](source-index.json) and [review provenance](review-provenance.json). The new source index contains 48 distinct URLs; this is not a count of independent witnesses.

The batch runner uses locally cached, checksum-verified regional PBFs and makes no network queries. Selected OSM boundary-member coverage was complete for these four extracts, but that does not establish real-world inventory completeness. Kenya snapshots are dated 21 October 2026; Mexico and the checked Alsace/Lorraine union are dated 20 October 2026. Original downloaded bytes, code hashes, selected geometry, node graph and curated association hashes identify the exact inputs. Antimeridian, polar and oversized frontiers are rejected for separate treatment rather than processed with an unsuitable projection.

Verification covers extraction scope, boundary membership and coverage failures, raw contacts, changed road references, interior junctions, source-coordinate checks, exact regional deduplication, batch resume and path guards, workbook accounting, stale-input rejection, provisional component separation and zero automatic closure links. The extracted road geometry and frozen review evidence remain historical. Their original workbook SHA is preserved, while the current priority queue is independently reconciled to the replacement workbook. The current map retains line-only reference display and preserves workbook phase bindings separately.

Reference geometries: © OpenStreetMap contributors, ODbL 1.0. Preserve attribution and the licence when redistributing derived OSM data. Workbook claims and supporting documents remain separately attributed.
