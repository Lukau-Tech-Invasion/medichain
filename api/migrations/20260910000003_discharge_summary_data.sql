-- `discharge_summaries` never had the `data` column its readers serve.
--
-- Three things were true at once and only the third was visible:
--
--   * `PgDischargeSummaryRepository::update` binds `data`, with a comment
--     explaining that an update omitting it "reports success while every reader
--     keeps seeing the values the record was first created with". The column it
--     names does not exist, so approving a discharge summary answered
--     `500 column "data" of relation "discharge_summaries" does not exist` —
--     every approval, on PostgreSQL only.
--   * `create` never bound `data` at all, and the entity carries
--     `#[sqlx(skip)]` on it, so on PostgreSQL the blob was always
--     `Value::Null`.
--   * `list_discharges` maps each row to `e.data` — so even once the list query
--     was fixed, it would have returned a page of nulls.
--
-- The typed columns hold the summary; the blob holds the shape the discharge
-- screen renders, which is nested (instructions grouped by category, follow-up
-- appointments, medicines with dose and duration) and does not decompose into
-- columns without losing the grouping. Both are wanted, so the column is added
-- rather than the blob removed.
ALTER TABLE discharge_summaries
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN discharge_summaries.data IS
    'The summary as the discharge screen composed it. The typed columns above are authoritative for querying; this preserves the grouping the printed summary is rendered from.';
