-- `physician_orders` never had the `data` column its update binds.
--
-- Exactly the defect `20260910000003` fixed for `discharge_summaries`, in the
-- table next to it: `PgPhysicianOrderRepository::update` binds `data` with a
-- comment explaining that an update omitting it "reports success while every
-- reader keeps seeing the values the record was first created with" — and the
-- column does not exist. So advancing an order from Pending to Completed
-- answered `500 column "data" of relation "physician_orders" does not exist`,
-- on PostgreSQL only, for every order ever raised.
--
-- The consequence is not a failed button. An order whose status cannot move is
-- an order that stays on the worklist after it has been actioned, which is how
-- two clinicians action the same order twice.
ALTER TABLE physician_orders
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN physician_orders.data IS
    'The order as the ordering screen composed it. The typed columns are authoritative for querying; this preserves what the form captured.';
