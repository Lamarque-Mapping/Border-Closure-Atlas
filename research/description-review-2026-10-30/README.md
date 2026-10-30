# Case descriptions — 30 October 2026

This work resumes the interrupted request to replace mechanically assembled
closure summaries with individually written, clear and neutral descriptions.
The existing source audits, saved source passages and current phase decisions
are reused. This is a prose and claim-consistency review, not a new full-register
web scrape or an additional independent human verification.

Each record receives two passes by different AI agents. The first writer reads
the current evidence and writes the description. Assignments are then rotated;
the second reviewer checks the paragraph against the original evidence and
revises it where needed. Saved review entries identify the reviewer, evidence
URLs, substantive checks and remaining qualifications. Any new source retrieval
is distinguished from inspection of saved evidence.

Descriptions explain the action, location, affected movement, time and reported
reason, with reopening information where supported. Material exceptions and
uncertainty remain explicit. Research-process language belongs in the evidence
sections rather than the opening paragraph.

`assignments.json` and `baseline.json` preserve the scope and original record
identities. The pass folders are checkpoints until every record has both passes.
`scripts/assemble-record-descriptions.py` requires complete, distinct-reviewer
coverage before assembling `source/record-descriptions.json`. The importer checks
each paragraph's source fingerprint before attaching it to website records.
Native dates, phases, sources, rationale codes and geographic bindings are not
changed by the prose overlay. Map and Dataset descriptions, record CSV exports
and the GIS export use the accepted description text.
