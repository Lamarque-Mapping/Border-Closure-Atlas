# Audited release integration

`audit-inputs.json.gz` preserves the final 829-row reader, both complete source
assessment passes and the accepted-change catalogues. `phase-patches/` contains
the separately reviewed native phase decisions. These are curated inputs, not
instructions to infer dates from free text. The original repository state is
pinned to `cc671f6a8ce83491d9db01f18c9fe0728239c129`.

`assemble-audit.py` applies the complete replacement, checks phase coverage,
retains original phase IDs and regenerates parent summaries and coverage counts.
`prepare-reader-method.py` prepares the reader model and methods; the existing
reader authoring script creates the workbook. Geography and status reconciliation
then bind their decisions to the new source hash. A full clone containing the
pinned commit is needed to rerun this migration.

The phase decisions preserve separate policy, announced, operational and
intermittent evidence. A later-access bound is not an exact reopening. Explicit
phase exclusion and strictly-over-24-hour evidence are separate from parent
inclusion and exact-duration eligibility. Phase-level rationale overrides can be
empty when the reason is not established.

The ordinary build does **not** rerun this research migration. It validates the
checked-in native source, reader model, workbook and manifest, then regenerates
the map, analysis, evidence readers and downloads using `.github/workflows/pages.yml`.
Generated website data is not tracked beside the authoritative source.

The integration report and independent phase QA retain the reconciliation checks.
Completing an audit does not establish every claim or remove recorded uncertainty.

The full additional audit history is packaged as a separate compressed member of
the data companion, avoiding duplication in the main native JSON. The companion
ZIP is regenerated in CI and must match its recorded SHA-256 before publication.
