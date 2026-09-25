-- Drop the stored lab-trend analyses, whose code was removed on 2026-09-25
-- at the owner's request ("delete what we don't use").
--
-- `POST /api/lab-trends/analyze` had no screen, and what it stored was
-- misleading: it called a coefficient of variation above 10% "statistically
-- significant" and attached clinical-significance prose to it. Trends are
-- served, to the patient and to their clinicians alike, by
-- `GET /api/lab-trends/patient/{id}`, which computes the same statistics
-- without the claim. Nothing references this table.

DROP TABLE IF EXISTS lab_trend_results;
