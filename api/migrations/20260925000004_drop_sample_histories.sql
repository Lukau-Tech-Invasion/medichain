-- Drop the standalone SAMPLE-history store, whose code was removed on
-- 2026-09-25 at the owner's request ("delete what we don't use").
--
-- `POST /api/clinical/sample` and `GET /api/clinical/sample/{patient}` had no
-- screen. SAMPLE history is taken by the ambulance crew and now travels inside
-- the EMS handover (`POST /api/emergency/ems-handoff`), which has one. Nothing
-- references this table.

DROP TABLE IF EXISTS sample_histories;
