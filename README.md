# Border Closures Atlas

The current workbook is the sole research source for Map, Analysis, Methods,
exports and downloads. It entirely replaces the previous dataset.

Source: `source/Global_Border_Closures_Register_2016_2026.xlsx`
Snapshot: 23 October 2026 (`border-corrections-20261023`).
Study window: 21 October 2016–21 October 2026.

There are 701 parent records: 697 included, three quarantined and one excluded.
Of the included records, 695 have dated evidence and 252 have a complete
operational duration for their stated scope, including 163 with exact dates.
The 827 phase rows remain separate. Nineteen held phases in included records
supply labelled evidence dates, not confirmed intervals. Only H06 and R2-EA-002
have no dated phase. There are 371 open evidence items across 218 records.

Ten nonexclusive rationale categories use distinct parent-record counts.
The current taxonomy includes Administration and service operation and
Environment and resource management. Twenty included records have no assigned
category, including unknown reasons and documented reasons outside the taxonomy.
Categories, related parents and phases can overlap; do not sum them as independent
closures or aggregate their days. Short land closures remain included; airport
and sea-only restrictions are outside this release.

The map and PNG exports display linework only. Colours locate the general border
references associated with filtered records; they are not approved phase geometry
or closure extents. Selecting a month selects records with evidence then, not a
finding that the entire coloured border was closed. A shared border with several
codes uses the multiple-rationale colour without inventing a primary rationale.
Individual crossing dots remain hidden. Workbook phase-coordinate decisions are
kept separately: 16 approved approximate bindings use nine published markers;
unlocated, rejected and unverified bindings are not silently upgraded.

OSM reference research lives in `research/osm/`, with a reproducible Uganda
pilot, candidate review tables and source geometries. It is separate from the
workbook and is not loaded by the website. See `research/osm/README.md`.

Current conclusions come from Register, Durations, Chronology phases and Follow-up
review. Initial Audit review claims, original parent dates and numbered research
rounds remain explicitly historical. Earlier Codebook snapshots and historical
Timing coverage columns do not describe the current release. Source index groups
retrieval histories by record and URL, preserving full, indexed and failed access
and shared reporting origins. The correction pass used six regional AI reviewers
and root integration within the same model; no human or different-model validation
is claimed. Review completion does not establish resolution of every attribute.

The base geometry is a reference asset, not a second research source for dates or
closure findings. Record geography is reconciled against the replacement workbook;
a phase applies only to its stated scope, traffic and direction. No record content
or editorial overrides from the previous release are merged. A last observation,
legal transition or scheduled expiry is not an observed reopening. Endpoint truth
and inclusion are retained explicitly; date arithmetic never adds a day merely
because an endpoint is inclusive. Isolated and held observations do not fill gaps.

## Rebuild

Python 3 with openpyxl is required; Node.js is needed for interaction checks.
No build system or package installation is required to run the website.

```
python scripts/rebuild.py --output releases/current_public
```

This reads the workbook, renders the Analysis page, builds the self-contained
HTML and CSV/JSON exports, and regenerates the GeoPackage/QGIS project.
Use `--skip-gis` during web-only development. The website is the generated `web`
folder. An input replacement is a complete replacement, matched by record ID.
New IDs without reference geometry remain unlocated until geographical review.

For this hosted source checkout, `dist` contains the full release and `out` is
the generated hosting directory. To update them:

```
python scripts/import-workbook.py
python scripts/build-analysis.py
node scripts/build-web-data.cjs
node scripts/build-hosted.cjs
python scripts/verify-workbook.py
node scripts/verify-ui.cjs
node scripts/verify-cards.cjs
```

The import report includes the input SHA-256 and reconciled counts. Exact source
spelling remains in raw data; the interface formats duration units as “days”.

The hosted atlas opens with `map-data.js`: browsing fields, timeline dates and
the original map coordinates. Full evidence loads by record when opened. The
complete research archive loads for exports. `data.js` is generated from the
tracked source workbook and embedded by the standalone builder for offline use.
It is excluded from Git because the complete generated file exceeds the source
hosting limit; the versioned record files retain the same data for the website. Run
`build-web-data.cjs` after changing the dataset; it writes versioned record files
and an updated map asset URL. The build does not change any research findings.

## GitHub Pages

The `Publish Border Closure Atlas` workflow publishes `out` on pushes to `main`
and can also be run from the Actions tab. Select **GitHub Actions** as the source
under **Settings → Pages**. The workflow sets the public URL from GitHub's Pages
configuration, keeping startup and offline links on the published host. Assets,
record downloads and Analysis links use relative paths and support a project
URL such as `/Border-Closure-Atlas/`.

The website is static and needs no API keys or external database. The downloadable
workbook and record evidence are published with it. The separate `.openai`
configuration belongs to the existing ChatGPT-hosted copy; GitHub Pages publishes
only `out`.

## Verification

Workbook totals, phase arithmetic, inclusion, URL joins, current review fields,
category counts, timeline exclusions and CSV/JSON exports are checked. Navigation
and all record/card render paths are exercised in a JavaScript DOM harness.
Browser visual checks were unavailable in this environment. QGIS output is
checked structurally (SQLite integrity, geometry decoding and relative paths);
native QGIS rendering was not run. Temporal GIS outputs must use the current phase
dates, endpoint meanings and binding decisions; all phases remain in the chronology
table.

## Reference assets

Natural Earth reference boundaries and countries are bundled. Crossing geometry
retains its per-feature OpenStreetMap or other recorded location provenance;
OpenStreetMap data is © OpenStreetMap contributors (ODbL). Leaflet and font
licences are included with the web assets. No external tile server is required.
Evidence links require an internet connection.

Hosting uses the generated `out` directory. It excludes the full offline `data.js`; exports load the checked manifest and its record parts on demand. All hosted files are checked to be smaller than 10 MB.
