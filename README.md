# Global Border Closures Atlas

Release **2026.10.25-rec50**, prepared on 25 October 2026. The study window is
**21 October 2016–21 October 2026**.

The final register contains **829 records**, of which **825 are included** in the
land-border analysis, and **1,010 separate phases**. The union of its per-record
source catalogues contains **4,680 distinct URLs**. This is not a recursive count
of every URL string in supporting or historical materials, nor a count of
independent reports or successful full-text inspections.
Coverage remains incomplete and differs by place, period and source access.

The public site keeps the Map / Overview / Analysis / Dataset presentation.
Overview contains the research methods and summaries of rationale and date
evidence. Analysis retains its chart navigation and filters. Dataset provides the
searchable record reader and downloads. Existing section and record links remain
supported. The atlas describes historical evidence, not live border conditions.

## Later-status correction — 25 October 2026

The map now distinguishes an observed reopening from the last report of closure.
All **221 records / 250 last-confirmed phases** in the review inventory have now
received a later-status assessment. Evidence supports map updates to **88 records**
and resolves **101 phase markers**. **136 records retain at least one unverified
phase (149 phases)**; the groups overlap for partial resolutions. Grey dashed
lines and hollow marks identify that uncertainty, not continuing closure.
The searchable [audit reader](https://lamarque-mapping.github.io/Border-Closure-Atlas/status-audit.html)
provides every finding, phase decision, source and access limitation.

The outcomes are 57 later access bounds, 26 confirmed restrictions, one
operator-reported restriction, 13 scope changes, 22 partial findings, five later
closure confirmations, three conflicting findings and 94 unresolved findings.
A later access bound does not assert that a border is currently open or supply
an exact historical reopening date. Only supported matching phases are updated.
Chile's partial reopening is not extended to all crossings; Burkina Faso's July
lifting and October reimposition of its flour-export ban remain distinct.

Thirty-three separately sourced October status observations include the Ukraine–Russia
and inter-Korean borders and restricted Rafah passenger access. Each carries its
actual observation date, scope, exceptions and evidence. The observations do not
interpolate earlier months, enter closure-duration statistics or count as new
closure episodes. Some were checked after the original 21 October study cutoff;
their actual dates remain visible. The historical 829-record reader is unchanged.
The companion ZIP and `downloads/border-status-review.json` include this review.
The review was an AI source assessment, not independent field verification.

Country outlines are restricted to the separately sourced Australia and New
Zealand broad foreign-visitor admission bans. Testing, quarantine, targeted-origin
rules and departure restrictions do not independently create a country outline.
The original UK policy evidence remains available; qualifying land records retain
their ordinary inclusion criteria. The extra UK country outline is removed.

## Downloads and source data

- **Global_Border_Closures_Master_2016_2026.xlsx** is the reader workbook, with two
  visible tabs: **Closures** and **Methodology**. It replaces the earlier workbook
  presentation with dozens of supporting and historical sheets. For unusually
  long cells, expand the formula bar to read the complete text. Complete phase
  and source detail is also available in the data companion.
- **Global_Border_Closures_Data_2016_2026.json.gz** is the structured data companion.
  It retains the current research tables, phase-level chronology, source access,
  review histories, unresolved findings and provenance.
- **Global_Border_Closures_Data_2016_2026.zip** packages the data companion and
  supporting tables/documentation. The master workbook is also offered separately.
- The site continues to export included records, filtered records, chronology
  phases, timing coverage, the website snapshot and current review information.
  The included-record CSV contains all 825 included land records, regardless of
  active browser filters.

The build reads `source/current-release.json.gz`. The shared methodology is
`source/release-method.json`; its complete account is used in Overview and the
standalone Analysis page. These files define the release input. The two-tab
workbook is a reader download, not the input schema for the website importer.

The compressed source-file hash, canonical research-state hash and downloadable
workbook hash identify different objects. Download metadata records each file's
own SHA-256; a workbook fingerprint is never substituted for a research-state or
data-source fingerprint.

## Research and review

The dataset was compiled using OpenAI’s GPT‑6 Astra with Ultra reasoning, with GPT‑6 Astra Pro documented in the final research and review logs. The work comprised 16 initial research rounds, including three full-register verification exercises, followed by two further register-wide reviews and 50 additional research and review cycles. Six regional AI reviewers contributed to major assessments, with research, challenge and adjudication conducted in separate contexts of the same model. Reviewers checked whether each restriction occurred, its start and endpoint, the crossings and types of movement affected, continuity, and the reported reasons against linked source evidence. The two subsequent register-wide exercises comprised a blind reconstruction and challenge of 653 records, producing 3,918 claim assessments, and a further assessment of all 686 records and 738 phases in the expanded register. Additional chronology work assessed 519 cases and subjected 272 unresolved cases to fresh research and separate review. The final 50 cycles comprised 30 coverage-search cycles, ten targeted-verification cycles and ten audits of preselected records, providing full-record source reviews of 160 entries and addressing 176 targeted questions across 162 entries. Proposed additions were checked against existing episodes to avoid duplication, while partial reopenings and changes in restrictions were recorded as separate phases. The resulting register contains 829 records and 1,010 phases, supported by a catalogue of 4,680 distinct recorded URLs. Automated consistency checks covered the complete final dataset; uncertain dates, source-access limitations and unresolved claims remain explicit. The five register-wide reviews covered successive versions of the dataset, while the later targeted audits examined selected records.

The reviews used separate contexts within the same model. They do not constitute
independent human or different-model verification of every record. The three
initial register-wide checks are included in the 16 initial rounds. The five
register-wide reviews covered successive versions, not five reviews of the final
829-record edition. The final 160 full-record audits and 176 targeted questions
across 162 records are cumulative review measures and can overlap. A record's
latest review label does not describe its complete review history.

Completing a review does not establish every date, attribute or claimed
explanation. Current conclusions take precedence over labelled historical
findings, while unresolved questions and failed source-access attempts remain
visible. Different websites can reproduce the same report. The evidence catalogue
preserves reporting origins and access limits where recorded.

## Reading the maps and analysis

The land register includes restrictions at international land borders and
cross-border river ferries, including restrictions on particular people or goods.
Routine opening hours, individual visa refusals and checks that still permit
passage are outside its scope. Airport and sea-only restrictions are excluded from
the core land analysis. Selected national COVID-19 passenger rules for Australia,
New Zealand and the UK remain a separate contextual supplement and do not enter
the land-border charts.

A parent record can contain several phases with different dates, directions,
locations and affected movement. Related parents can describe parts of the same
policy or event. Record counts are not counts of independent closure decisions;
phases and their days should not be summed into an assumed continuous closure.
The ten rationale categories overlap and retain their source attribution.

**Border Restrictions** shows the recorded evidence for the selected month.
**Phases beginning** shows records with a supported phase start in that month,
including separately labelled operational, policy and scheduled phases. It does
not measure the incidence of unique new closure decisions. **All recorded
closures** searches the full study period, including records without confirmed
dates.

The date button selects a month and year directly. Playback retains the 1×, 2×,
4× and 8× speed choices. On compact screens, Play, date and speed fill their row
with proportional widths and consistent gaps; the previous/next arrows flank the
slider below. Navigation and other controls keep the existing public layout.

An observed restriction, a policy in force, an announced schedule, a last report
of closure and an observed reopening are different facts. Unknown endpoints are
not extended to the present. Held and isolated observations remain visible
without filling gaps. Date subtraction measures calendar-day differences; it
never adds a day merely because an endpoint is described as inclusive.

The exact-duration chart requires eligible operational phases with exact dates
and an observed reopening. The optional **More than 1 day** filter requires a
supported operational lower bound above one day; every phase plotted in the
exact-duration chart must also pass that threshold. The accompanying coverage
chart shows the contributing sample. The charts describe collected evidence,
not worldwide closure rates or causal effects of rationales.

Map dots locate reviewed crossing-area references. Their size does not encode
duration, severity or record count. Wider restrictions retain the established
line styles. A known single-post restriction never falls back to a whole-border
highlight. Unresolved or partially located records remain searchable and
available in the data, with their mapping limits stated. Neutral boundary
references and optional earlier-record rings do not establish a border's later
status. Phase-specific mapping uses the reviewed scope, traffic and direction.

See `source/crossings/README.md` for the location inputs and review procedure.
OSM research is retained separately under `research/osm/`; only explicitly
reviewed bindings enter the public crossing layer.

## Rebuild the hosted site

The build uses Python 3 and Node.js. Spreadsheet checks also use openpyxl. The
website itself is static and requires no API keys, database or external tile
server. Evidence links require an internet connection.

After the current source data, master workbook and companion downloads have been
prepared and checked, the hosted build is:

```sh
python scripts/import-workbook.py
python scripts/build-analysis.py
node scripts/build-web-data.cjs
node scripts/build-national-data.cjs
node scripts/build-crossing-geography.cjs
node scripts/build-status-review.cjs
node scripts/build-evidence-pages.cjs
node scripts/build-hosted.cjs
```

An ordinary rebuild from a clean public checkout uses the checked-in
`source/current-release.json.gz`, `source/current-reader-model.json` and final
reader/download files. It does not require the preserved research programme or
its private archive.

Re-preparing this particular release is a separate maintenance operation.
`scripts/prepare-current-release.py --programme PATH` requires the programme's
`compact/data/current-state.json.gz`, the original R50 data gzip, reader model and
research summary, and the accepted patch and completion receipt for all 50
rounds. Those archival inputs are not ordinary public-build prerequisites. The
preparer is deliberately bound to the R50 state and counts; it is not a generic
importer for future replacement spreadsheets.

The GitHub Pages workflow specifies the complete release sequence and its checks.
The earlier workbook repair/layout scripts retain the old workbook assumptions;
they are not the source of the two-tab R50 reader or a substitute for the current
data importer.

`dist/index.html`, the runtime scripts and CSS provide the public shell.
`scripts/analysis-template.html` and `scripts/analysis-ui.js` generate
`dist/analysis.html`; edit those source files rather than only the generated page.
`build-web-data.cjs` generates the map payload, content-addressed record files and
research archive manifest. `build-analysis-data.cjs` generates the light Analysis
payload and updates its fingerprints. The evidence-page builder generates the
readable crossing and national-policy source pages.

`dist/data.js` is the complete generated browser-data model. Hosted pages open the
light map or Analysis payload and request full evidence when needed. The hosted
builder copies the release to `out/`, excluding the large offline `data.js`.
Versioned record parts support complete website exports. All hosted assets remain
subject to the size limit enforced by the builder.

## Verification and publication

The checks reconcile the source tables with inclusion, phases, date arithmetic,
review coverage, source references, downloads and browser outputs. Analysis
expectations are derived independently from native release tables; behavioural
fixtures cover leap dates, uncertain bounds, reopening requirements, held phases,
nonexclusive rationales and filtered exports. Navigation and record interactions
also have a JavaScript DOM harness. The workflow runs the required release gates
before uploading `out`.

The public navigation, Methods routing and mobile controls must be checked after
regeneration. Browser layout checks are not tests on physical iOS or Android
devices. XLSX package and content checks do not claim native Microsoft Excel
validation. Historical GIS/export tools must retain the current phase dates,
endpoint meanings and binding decisions if used for a new export.

The **Publish Border Closure Atlas** workflow publishes `out` on pushes to `main`
and can be run from the Actions tab. GitHub Pages uses **GitHub Actions** as its
source. Assets and links are relative and support the project's `/Border-Closure-Atlas/`
path. Preparing or rebuilding a local release does not itself publish it.

## Citation and reuse

Lamarque, H. (2026) *Global Border Closures Atlas*. Version 2026.10.25-rec50.
Available at: https://lamarque-mapping.github.io/Border-Closure-Atlas/
(include your access date). Machine-readable citation metadata is in `CITATION.cff`.

Research by Dr. Hugh Lamarque, with thanks to Dr. Robert Macdonald for review and
feedback. Framework and selected prose are adapted from Hugh Lamarque's
*Border Closures in Africa*.

This release does not introduce a new licence grant for the atlas code or compiled
research dataset. Natural Earth reference geography is bundled; crossing features
retain their recorded OpenStreetMap or other source attribution. OpenStreetMap
data is © OpenStreetMap contributors (ODbL). Leaflet and font licences are included
with the web assets. Source publications retain their own terms.
