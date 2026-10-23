BORDER CLOSURES — CORRECTED WORKBOOK GIS

Open border_closures_atlas.qgs in QGIS, keeping the .gpkg beside it.
The 23 October 2026 replacement contains 701 parent records: 697 included,
three quarantined and one excluded. All remain in the events table; excluded
records have no event geometry. The study window remains 21 October 2016 to
21 October 2026. Short land closures remain included; airport and sea-only
restrictions are outside this release.

Static record-reference layers locate the general geography associated with
records. They are not approved phase geometry, a closed border's extent or a
historical obstruction footprint. Count distinct event_id, not repeated
geometries. They have no temporal start/end fields populated. The default
project shows linework and country reference outlines; point layers are hidden.

approved_phase_points contains only the workbook's approved_approximate
phase-coordinate bindings: 16 bindings at nine published approximate markers.
These apply only to their stated phase, crossing, traffic and direction.
Rejected, unverified and unlocated decisions remain in workbook_phase_locations;
they never inherit a different phase's coordinates. No marker is a surveyed gate.

interval_points is an optional, deliberately narrow QGIS temporal layer. It
requires an approved approximate binding, exact complete operational dates,
explicit observed reopening (Yes), an exclusive endpoint, and no held evidence.
Only two phases currently meet all these conditions. They are not a representative
sample of the register's 163 parents with an exact complete operational duration.
Start is inclusive and reopening exclusive; midnight is a date-display convention,
not a measured clock time. Inclusive or unknown endpoint treatment is retained in
the chronology table rather than silently changed for native temporal playback.

chronology_phases retains all 827 phases, including 825 for included parents and
19 held phases in included records. Bounded dates, same-day interruptions,
confirmed-through observations, reopening-only evidence, formal rules, schedules,
intermittent periods and held evidence remain inspectable with their exact source
rows and temporal display rules. They are not promoted into continuous intervals.
After the evidence ends the state is unknown unless an observed reopening is
established for the same scope. Endpoint inclusion does not add a day automatically.
Do not sum overlapping phases or extend an unknown endpoint to the study cutoff.

Current Register, Durations, Chronology phases and Follow-up review conclusions
supersede initial Audit review findings and explicitly historical parent claims.
The current correction used six regional AI reviewers and root integration in
the same model; this is not human or different-model validation. There are 371
open evidence items across 218 parents. Review completion does not settle every
attribute. Related records and nonexclusive rationale groups can overlap.

The GeoPackage includes complete current phase-location decisions, workbook
locations, follow-up reviews, audit changes, relationships, country-year coverage
and labelled source histories. The release's tables folder exports every workbook
sheet, retaining numbered research rounds as historical material. Failed source
retrieval is not full access; multiple publishers can share one reporting origin.
Search coverage is partial and does not establish absence of closures.

The builder checks SQLite integrity, geometry encoding and relative QGIS paths.
Native QGIS rendering has not been tested in this environment.
