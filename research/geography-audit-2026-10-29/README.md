# Independent geography reconstruction

This audit covers the 387 included historical-register records that had no
reviewed map feature at any time in the 26 October release. The starting
coverage was 439 of 826 included records. It does not label every unmapped
record as inherently unlocatable or make a claim about all previous websites.

Two researchers independently reconstruct each assigned record from its cited
closure evidence and geographical sources. They have the same canonical
inputs and may inspect earlier geography as leads, but do not read each
other's recommendations. The three regional groups each have one A and one B
researcher. The coordinating reviewer reconciles their separately saved work.

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
