-- Migration: reconcile relay_execution_acks with what the API actually writes,
-- confirmed against the schema-10july dump (real columns: relay_id, relay_mac,
-- channel, state, status, logged_at — missing command_id/hub_id/execution_status/executed_at,
-- which is what acknowledge_commands() and get_device_history() in telemetry.py write/read).
-- Every statement is idempotent; re-running is harmless.

ALTER TABLE relay_execution_acks ADD COLUMN IF NOT EXISTS command_id BIGINT;
ALTER TABLE relay_execution_acks ADD COLUMN IF NOT EXISTS hub_id VARCHAR(64);
ALTER TABLE relay_execution_acks ADD COLUMN IF NOT EXISTS execution_status VARCHAR(50);
ALTER TABLE relay_execution_acks ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'relay_execution_acks_command_id_fkey'
    ) THEN
        ALTER TABLE relay_execution_acks
            ADD CONSTRAINT relay_execution_acks_command_id_fkey
            FOREIGN KEY (command_id) REFERENCES relay_commands_queue(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_relay_acks_command_id ON relay_execution_acks (command_id);
CREATE INDEX IF NOT EXISTS idx_relay_acks_hub_time ON relay_execution_acks (hub_id, executed_at DESC);

-- The pre-existing columns (relay_id, relay_mac, channel, state, status, logged_at) are left
-- untouched — nothing in the current codebase writes to them, but nothing reads them either,
-- so dropping them isn't necessary and risks losing whatever historical rows already exist there.
