GLOBAL BORDER CLOSURES ATLAS — GIS DOWNLOADS
https://lamarque-mapping.github.io/Border-Closure-Atlas/

GETTING STARTED
Unzip the download. In QGIS or ArcGIS, open Global_Border_Closures.gpkg and
select crossing_points and border_lines. The GeoJSON download supplies the
same spatial layers as separate files, with the register tables as CSV files.
Coordinates use WGS 84 (EPSG:4326), longitude then latitude, in decimal degrees.

These downloads cover the historical land-border register across all dates
and durations, regardless of the website's current filters. The manifest
identifies the exact release, input fingerprint, study window and row counts.
Selected national visitor-entry policies and supplemental later-status
observations are separate from this register; they are not included here.

CURRENT MAPPING COVERAGE

WHAT A FEATURE MEANS
Each spatial feature represents ONE RECORD PHASE AT ONE LOCATION OR BORDER REFERENCE.
A phase describes one stage of a restriction. Several phases can share a
crossing, and a phase can cover several crossings or border references.
Count distinct record_id for record totals; feature counts are not counts of
independent closure decisions. Geometry is static across the full inventory,
not a map of borders currently closed.

crossing_points: sourced, approximate crossing locations. A coordinate does
not establish the exact position of a barrier or its historical footprint.
border_lines: wider-policy geography and dotted known-border references used
by the website. map_representation="border_reference" means the affected
border is established but the precise crossing or extent remains unresolved.
The line does not establish closure along the entire border. Read scope,
scope_category, locations_partial, geometry_note, border_reference_qualification
and qualification. For these reference features the original single-site or
other scope_category remains intact; it is not upgraded to wider-border scope.
context_areas, when present: reference areas only, not closure footprints.

Only the current phase-specific geography reviews supply features. A named
crossing with no reviewed coordinate can use a clearly labelled border reference
when the affected border is established in both saved source reconstructions.
This is a reference line, not a reconstructed restriction footprint. In counts,
located_records and border_reference_only_records distinguish these levels;
mapped_records includes both. All records, including excluded records, remain in the
records table. All phases remain in phases. Unmapped included phases are
listed in unmapped_phases; records without any geometry have mapped_features=0.
Some mapped records also contain unmapped or partially mapped phases.

DATES AND DURATION
start_earliest/start_latest and end_earliest/end_latest are the recorded bounds,
not necessarily a continuously observed closure. measure_type, kind,
temporal_display_rule, continuity_status, endpoint_status, observed_reopening,
contested and qualification describe their meaning. Policy dates, announced
schedules, intermittent restrictions and actual stopped passage differ.

last_confirmed is an observation date, NOT a reopening. A missing end is left
blank; it is not extended to today. Do not animate every feature between its
first and last date or sum overlapping phases. geometry_valid_from, if set,
qualifies when that particular location applies within a staggered onset;
it is not a replacement for the phase's original date evidence.

To reproduce the website's >24h eligibility, filter over_24h = 1. For register
totals also use included = 1. A zero over_24h value can mean insufficient
duration evidence, not necessarily a short restriction. minimum_days and
maximum_days are source-supported calendar-date differences, not measured
elapsed hours. For exact completed operational comparisons, also inspect
exact_complete_operational, observed_reopening and the endpoint qualification.

ATTRIBUTES AND SOURCES
Join records to phases or sources on record_id. Join a feature to its phase
on phase_id. record_url opens the website record. source_urls retains the
links to news reports, government announcements and other evidence; phase
features carry their phase-specific URLs, and records retains all recorded
URLs. The sources table preserves the available catalogue fields and access
histories. Source links do not guarantee accuracy or independent confirmation.
Some pages were inaccessible or available only as extracts. Read source_access
and the full record before using a finding. AI errors remain possible.

Dates stay ISO text (YYYY-MM-DD) to preserve nulls and bounds without invented
times. Lists and nested source histories are JSON text, except countries,
continents, rationales and source_ids (semicolon-separated), and URL lists
(newline-separated). GeoPackage keeps full text without shapefile field-name
or text-length truncation. fields.json lists the stored columns and types.
CSV files are UTF-8; formula-like text is prefixed with an apostrophe for safe
spreadsheet opening. The GeoPackage and GeoJSON preserve the original text.

RESEARCH AND ATTRIBUTION
Research and mapping: Dr. Hugh Lamarque. With thanks to Dr. Robert Macdonald
for review and feedback. Supported by the Leverhulme Trust.
The full research and review account is in research-method.json, and also in
the GeoPackage research_method table. The source workbook and data companion
on the website retain the wider audit history and supporting research tables.

Boundary reference geometry: Natural Earth (public domain).
Location evidence: sources are retained in geometry_source_urls and
geometry_provenance. OpenStreetMap data is copyright OpenStreetMap contributors,
available under the Open Database License (ODbL):
https://www.openstreetmap.org/copyright
Other source material retains its original attribution and terms. This export
does not introduce a new licence grant for the compiled research. Generalised
modern boundaries are not historical reconstructions or endorsements of claims.

Suggested citation: Lamarque, H. (2026) Global Border Closures Atlas.
https://lamarque-mapping.github.io/Border-Closure-Atlas/
Give the dataset release shown in manifest.json and your access date.
