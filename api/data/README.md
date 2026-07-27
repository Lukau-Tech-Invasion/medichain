# Drug-interaction data pipeline

**Backs:** `IMPLEMENTATION_PLAN.md` §4.1 / `docs/NEXT_WEEK_TODO.md` — "Import
RxNorm/DrugBank open datasets to expand drug-interaction coverage".

## What's here

`drug_interactions_builtin.json` is the single source of truth for the curated
drug-drug interaction table used by `evaluate_drug_interactions()`
(`api/src/clinical_endpoints/insurance_pharmacy/drug_checking.rs`), which backs
both `POST /api/interactions/check` and the automatic screen run inside
`create_e_prescription`. It is compiled into the binary via `include_str!`, so
the checker always has a baseline with zero configuration.

## Schema

```json
{
  "interactions": [
    { "drug_a": "warfarin", "drug_b": "aspirin", "severity": "major",
      "description": "Increased bleeding risk: ..." }
  ]
}
```

- `drug_a` / `drug_b` — lowercase, matched as a case-insensitive **substring**
  against each prescribed medication name (so `"ssri"` matches `"fluoxetine
  20mg"` only if the medication string itself contains `"ssri"` — most rows use
  a specific drug name; a few use a drug-class keyword that callers are
  expected to include, mirroring the existing table's convention).
- `severity` — one of `contraindicated` / `major` / `moderate` / (anything else
  maps to `minor`).
- `description` — clinician-facing explanation of the mechanism and risk.

## Extending the table with a real licensed dataset

RxNorm's own interaction API (the former mashup of DrugBank + Micromedex data)
was retired by the NLM in 2024 over source-data licensing, and DrugBank's own
interaction export requires a commercial or academic license — neither is a
truly "open," programmatically-downloadable dataset this pipeline can fetch on
your behalf, and fabricating placeholder interaction pairs would be actively
unsafe for a clinical system. What this pipeline gives you instead is the
**import path**, ready for when you have a licensed export:

1. Obtain a licensed drug-interaction export (DrugBank commercial/academic
   license, a UMLS-licensed RxNorm-linked interaction source, or an in-house
   pharmacy formulary export).
2. Convert it to the schema above — one row per drug pair. A short script
   (Python/`jq`/spreadsheet formula) mapping the vendor's columns to
   `drug_a`/`drug_b`/`severity`/`description` is normally all that's needed.
3. Save the converted file anywhere the API process can read, e.g.
   `/etc/medichain/drug_interactions_overlay.json`.
4. Set `DRUG_INTERACTIONS_DATA_PATH=/etc/medichain/drug_interactions_overlay.json`
   (see `.env.example`) and restart the API.

The overlay is **additive** — it supplements `drug_interactions_builtin.json`,
never replaces it. If the file is missing or fails to parse, the API logs a
warning and falls back to the built-in table only (fail-open on startup, since
losing the *overlay* must never take down drug-interaction checking — the
built-in baseline still covers the ~170 most clinically significant
interactions used in emergency/general medicine).

## Growing the built-in table without a licensed dataset

`drug_interactions_builtin.json` can also be extended directly with additional
clinically-reviewed entries (same schema) — no license needed for
independently-authored clinical content, only for redistributing a vendor's
proprietary interaction database wholesale.
