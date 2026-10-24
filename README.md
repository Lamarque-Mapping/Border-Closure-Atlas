# Border Closures Atlas

The core land dataset uses the replacement workbook below for its historical
records, dates, rationales and Analysis. Separately reviewed crossing coordinates
control map positions without changing those findings. Selected national COVID
rules remain in the separate supplement and are excluded from core Analysis.

Source: `source/Global_Border_Closures_Register_2016_2026.xlsx`
Snapshot: 23 October 2026 (`border-corrections-20261023`).
Study window: 21 October 2016–21 October 2026.

The public navigation is Map / Overview / Dataset. Overview contains About &
methods and Analysis; Dataset provides the browser reader, workbook and CSV
exports. Legacy Analysis and record links continue to resolve. The map date
button selects a month and year directly, and Cite provides the Harvard
reference with the reader's access date. Location and national-policy sources
have readable HTML pages, with JSON retained as an optional technical download.

The 24 October workbook compatibility repair gives four internal table IDs
unique values. All 55 worksheet XML files, values and formulas are unchanged.
The repository retains the original research workbook. Before publication,
`scripts/prepare-release-workbook.py` applies and checks the repair using
`scripts/repair-workbook-package.py`, then the build regenerates the downloadable
workbook and all data assets. The published fingerprint identifies that repaired
package; historical research-input fingerprints remain unchanged.

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

The map and PNG export use phase-specific geography. Named crossings appear as
the same small rationale-coloured dots used in dotted border lines; larger
invisible controls support touch and keyboard use. Their size does not encode duration,
severity or record count. Wider rules retain the established line styles.

The 24 October 2026 location review contains 78 sourced crossing-area positions,
with 205 bindings covering 202 phases in 180 records. It covers all six
China–Mongolia phases at five road crossings. Of 431 single-crossing phases,
199 have reviewed positions and 232 remain awaiting location checks. A known
single-post restriction never falls back to a whole-border highlight. Partial
multi-site and unresolved cases remain searchable, counted and downloadable,
with their mapping status stated. All 697 included records, dates and Analysis
figures remain unchanged.

See `source/crossings/README.md` for the review files and update procedure.
The 16 workbook-approved approximate bindings are retained; rejected and
unverified old bindings are not silently upgraded. Coordinates are approximate
crossing-area references, not surveys of historical gates or obstructions.

OSM reference research lives in `research/osm/`, with a reproducible Uganda
pilot, candidate review tables and source geometries. It is separate from the
workbook. Only explicitly re-reviewed phase bindings are promoted into the
crossing layer; the research directory itself is not loaded by the website. See `research/osm/README.md`.

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
python scripts/prepare-release-workbook.py
python scripts/import-workbook.py
python scripts/build-analysis.py
node scripts/build-web-data.cjs
node scripts/build-crossing-geography.cjs
node scripts/build-evidence-pages.cjs
node scripts/verify-crossing-map.cjs
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
Crossing-point layouts and interactions have been checked in a browser at laptop,
portrait-phone and landscape-phone sizes. This is responsive-layout verification,
not testing on physical iOS and Android devices. QGIS output is
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

