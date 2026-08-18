-- Migration: /api/telemetry/acknowledge now accepts the payload shape the Hub firmware
-- actually sends (one physically-verified execution per call: relay_chip_id, channel,
-- state, success) — the strict legacy schema was 422-ing every ack, so relay execution
-- proof was never recorded. The two payload shapes populate different column subsets,
-- so the legacy NOT NULLs must relax to let either shape insert cleanly.

ALTER TABLE relay_execution_acks ALTER COLUMN relay_id DROP NOT NULL;
ALTER TABLE relay_execution_acks ALTER COLUMN channel DROP NOT NULL;
ALTER TABLE relay_execution_acks ALTER COLUMN state DROP NOT NULL;
