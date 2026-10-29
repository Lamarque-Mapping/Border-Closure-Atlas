# Independent geography reconstruction

This audit covers the 387 included historical-register records that had no
reviewed map feature at any time in the 26 October release. The starting
coverage was 439 of 826 included records. It does not label every unmapped
record as inherently unlocatable or make a claim about all previous websites.

Two AI agents independently reconstructed each assigned record from its cited
closure evidence and geographical sources. They have the same canonical
inputs and may inspect earlier geography as leads, but do not read each
other's recommendations. The three regional groups each have one A and one B
researcher. Separate regional reviewers compared the two passes before the
coordinating reviewer reconciled their separately saved work.

The audit was completed on 29 October 2026: 774 saved reconstructions cover all
387 assigned records. Reconciliation approved geography for at least one phase
of 242 records, raising coverage from 439 to 681 of 826 included records.
The remaining 145 records retain explicit hold reasons. An approved record may
still have unmapped phases or only partial spatial coverage. This is coverage
across the historical register, not the number of closures at any one date.

The final metadata review corrected 27 facility-country labels and consolidated
two duplicate facility IDs. It also prompted withdrawal of two provisional
Santa Rosa markers whose independent passes selected opposite-country controls.
Neither original mapped-record geometry nor native chronology was changed.

Each pass checks crossing identity, road/rail/ferry distinctions, geographical
extent, coordinate provenance and precision, phase applicability, and date
limitations. Source access limitations and unresolved findings are retained.
An inspected location source does not independently establish a historical
closure, and two AI passes are not independent human verification.

`pass-a/` and `pass-b/` contain individual record checkpoints. An audit file is
a research finding, not permission to map the record. `audit-plan.json` fixes
the record universe and original release fingerprint. Run
`node scripts/geography-audit-progress.cjs` to count saved, complete and paired
checkpoints. Its optional `--pairs` output is a comparison aid, not approval.

`baseline-map-bindings.json` preserves the original all-duration and >24h
geography separately. `verify-geography-audit.cjs` checks the two independent
reviewers and evidence hashes for each accepted addition, phase ownership,
and unchanged geometry for every previously mapped record. `reconciled-decisions.json`
is the coordinator's explicit decision log; `apply-geography-audit.cjs` applies
only supported decisions from that log.

The five largest geography/reconciliation JSON files are stored in Git as
small deterministic gzip chunks under `source/geography-audit-payloads/`.
Run `python scripts/materialize-geography-audit.py` after a fresh checkout to
restore the original JSON byte for byte. The manifest verifies each chunk,
compressed stream and restored file; changed local JSON is never overwritten.
Release preparation and CI restore these files automatically. Their research
hashes and public downloads still refer to the original uncompressed JSON.

After intentionally changing reviewed geography, run
`python scripts/materialize-geography-audit.py --pack`, followed by
`python scripts/prepare-release-workbook.py --bind-manifest` locally, then the
normal site build and validation sequence. Geography is included in the data
companion, so that package and its manifest fingerprint must be regenerated
together. CI still verifies the bound bytes and never silently rebinds them.

Referenced publisher pages are working evidence, not republished articles.
Some local evidence paths therefore are not public downloads; the original
source links, access status and findings remain in each audit file. Retained
OpenStreetMap XML is © OpenStreetMap contributors, under the ODbL:
https://www.openstreetmap.org/copyright

Only reconciled, evidence-supported decisions enter production geography.
Missing or disputed dates do not acquire invented continuous intervals or
reopening dates. Single crossings never receive a whole-frontier substitute.
The unchanged native record/phase data remain the source of chronology,
analysis inclusion, rationale coding and duration eligibility.

Progress is saved in the geography audit branch before integrating supported
map additions into the main site. Completion counts must distinguish a pass
saved, both passes reconciled, a mapped record and a still-unresolved record.
