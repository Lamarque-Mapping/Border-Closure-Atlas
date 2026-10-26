# Global Border Closures Atlas

Release **2026.10.26-full-audit-2**, prepared on 26 October 2026. The study
window is **21 October 2016–21 October 2026**.

The register contains **829 records**, of which **826 are included** in the
land-border analysis, and **1,069 phases** across all records. Inclusion is also
checked at phase level: SA025's supported rail phase is included, while its
unsupported road phase remains excluded. The union of the per-record source
catalogues contains **5,548 distinct URLs**. This is not a recursive count of
every URL in supporting or historical materials, nor a count of independent
reports or successful full-text inspections. Coverage remains incomplete and
differs by place, period and source access.

The public site keeps the Map / Overview / Analysis / Dataset presentation.
Overview contains the research methods and summaries of rationale and date
evidence. Analysis retains its chart navigation and filters. Dataset provides the
searchable record reader and downloads. Existing section and record links remain
supported. The atlas describes historical evidence, not live border conditions.

## Full-register audits — 26 October 2026

This release incorporates **two further complete audits of all 829 records**.
The first pass produced accepted content changes to **292 records**; the second
produced accepted content changes to **339 records**, plus **nine formatting-only
changes**. The content-change groups overlap: **505 distinct records** changed
across the two passes. **59 phases were added**, taking the chronology from 1,010
to 1,069 phases. These are review and revision counts, not counts of newly
discovered closure decisions or independently verified facts.

Regional reviewers checked the current claims against identified sources and
searched for missing or suspicious dates, reopening evidence, traffic scope and
geography. The second pass reassigned records to reviewers to challenge the
accepted first-pass version. Accepted corrections were reconciled into the native
phase tables as well as the reader: phase inclusion, date bounds, endpoint
meaning, strict duration eligibility and mapped scope must agree. Unresolved
claims and source-access limits remain explicit; completing both passes does
not establish every historical fact.

The earlier **25 October 2026 later-status review** covered an inventory of
221 records and 250 last-confirmed phases. Its
[audit reader](https://lamarque-mapping.github.io/Border-Closure-Atlas/status-audit.html)
and companion review preserve that dated assessment and its evidence. Those
inventory and outcome counts describe the earlier review, not the coverage or
remaining uncertainty of this full-register release. The current record reader
and native phase chronology incorporate the subsequent accepted findings.

An observed reopening, a formal policy ending, later evidence of access and the
last report of closure are different facts. A later access report can establish
an outer bound without revealing the exact reopening date. Neither that bound
nor an isolated closure observation establishes uninterrupted closure between
reports. Evidence is not extended through silence to the end of the timeline.
Separately sourced status supplements retain their chronology and exceptions;
the date they were checked is not substituted for their start. Supplements do
not count as new core closure episodes or enter core closure-duration statistics.
Some checks postdate the 21 October study cutoff; their actual dates remain visible.

Country outlines are restricted to the separately sourced Australia and New
Zealand broad foreign-visitor admission bans. Testing, quarantine, targeted-origin
rules and departure restrictions do not independently create a country outline.
The original UK policy evidence remains available; qualifying land records retain
their ordinary inclusion criteria.

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
  The included-record CSV contains all 826 included parent records, regardless
  of active browser filters. Phase-level exclusions remain explicit in the
  chronology; inclusion of a parent does not include every one of its phases.

The build reads `source/current-release.json.gz`. The large data companion ZIP is generated deterministically in CI and checked against the release manifest. Both complete additional audits are included in that ZIP as `Full_Register_Source_Audits_2026.json.gz`, also available as a separate download. The shared methodology is
`source/release-method.json`; its complete account is used in Overview and the
standalone Analysis page. These files define the release input. The two-tab
workbook is a reader download, not the input schema for the website importer.

The compressed source-file hash, canonical research-state hash and downloadable
workbook hash identify different objects. Download metadata records each file's
own SHA-256; a workbook fingerprint is never substituted for a research-state or
data-source fingerprint.

## Research and review

The historical research programme was compiled using OpenAI's GPT-6 Astra with
Ultra reasoning, with GPT-6 Astra Pro documented in its final research and review
logs. It comprised 16 initial research rounds, including three full-register
verification exercises, followed by two further register-wide reviews and 50
additional research and review cycles. Six regional AI reviewers contributed to
major assessments, with research, challenge and adjudication conducted in separate
contexts of the same model.

The two subsequent historical register-wide exercises comprised a blind
reconstruction and challenge of 653 records, producing 3,918 claim assessments,
and a further assessment of all 686 records and 738 phases in the expanded
register. Additional chronology work assessed 519 cases and subjected 272
unresolved cases to fresh research and separate review. The 50 additional cycles
comprised 30 coverage-search cycles, ten targeted-verification cycles and ten
audits of preselected records, providing full-record source reviews of 160 entries
and addressing 176 targeted questions across 162 entries. That programme produced
the 25 October edition of 829 records and 1,010 phases, with 4,680 distinct recorded
URLs. These historical totals are retained as provenance, not current release
counts.

The five historical register-wide reviews covered successive dataset versions,
not five reviews of the final 829-record edition. The three initial checks are
included in the 16 rounds. The 160 full-record audits and 176 targeted questions
are cumulative measures and can overlap. The two additional 829-record audits
reported above are separate from that programme. No model/version attribution
for these additional passes is inferred from the historical programme's logs.
Separate AI review contexts do not constitute independent human or different-model
verification.

Across the work, reviewers checked whether each restriction occurred, its start
and endpoint, the crossings and movement affected, continuity, and reported
reasons against source evidence. Additions were checked against existing episodes
to avoid duplication. Partial reopenings and material changes in restrictions
were represented as separate phases where supported. Automated consistency
checks cover the full release, but do not replace source assessment.

Current conclusions take precedence over labelled historical findings. A record's
latest review label does not describe its complete review history. Uncertain
dates, unresolved questions and failed source-access attempts remain visible.
Different websites can reproduce the same report, so the URL count does not
measure independent corroboration. The evidence catalogue preserves reporting
origins and access limits where recorded.

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

The default **>24h** view requires source support that at least one included
phase lasted strictly longer than 24 hours. A restriction described as exactly
24 hours does not qualify, and dates on consecutive calendar days alone do not
prove it exceeded 24 hours. Explicit evidence of a sustained restriction can
support eligibility even when its precise onset or reopening is unknown. Sparse
observations alone cannot establish continuity. **All** also shows shorter phases
and records whose duration eligibility remains uncertain.

This threshold is separate from eligibility for exact-duration statistics. The
exact-duration chart requires eligible operational phases with sufficiently exact
dates and an observed reopening; formal policy periods, scheduled endings, later
access bounds and isolated observations are not silently converted into exact
operational durations. The accompanying coverage chart shows the contributing
sample. The charts describe collected evidence, not worldwide closure rates or
causal effects of rationales.

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

From the checked-in current source data and reader model, the hosted build is:

```sh
python scripts/prepare-release-workbook.py
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
`source/current-release.json.gz`, `source/current-reader-model.json`, shared
methodology and reviewed geography/status inputs. CI regenerates and checks the
workbook, companion downloads, browser data, record parts and generated evidence
pages from these inputs. Generated copies are ignored by Git and are not release
source files; do not edit or commit them in place of their generators. The public
build does not require the preserved research programme or its private archive.

Re-preparing the historical R50 programme is a separate maintenance operation.
`scripts/prepare-current-release.py --programme PATH` requires the programme's
`compact/data/current-state.json.gz`, the original R50 data gzip, reader model and
research summary, and the accepted patch and completion receipt for all 50
rounds. Those archival inputs are not ordinary public-build prerequisites. The
preparer is deliberately bound to the R50 state and counts; it is not a generic
importer for future replacement spreadsheets.

The GitHub Pages workflow specifies the complete release sequence and its checks.
The earlier workbook repair/layout scripts retain the old workbook assumptions;
they are not the source of the current two-tab reader or a substitute for the
current data importer. The full-audit migration is retained under `migration/`;
ordinary CI builds consume its accepted release output rather than rerunning
source research or the historical programme preparer.

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

Lamarque, H. (2026) *Global Border Closures Atlas*. Version 2026.10.26-full-audit-2.
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
