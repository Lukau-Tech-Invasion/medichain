-- Drop the autopsy request store, whose code was removed on 2026-09-25 at the
-- owner's request ("delete what we don't use", after investigation).
--
-- `POST /api/surgical/autopsy` and `GET /api/platform/list/autopsy` had no
-- caller: AutopsyPage creates and lists autopsy REPORTS only, and fetched the
-- request register without ever rendering it. The table held 0 rows when
-- measured on 2026-09-25 and nothing references it.

DROP TABLE IF EXISTS autopsy_requests;
