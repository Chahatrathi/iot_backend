-- Migration: heartbeat status tracking, boot-event logging, OTA firmware registry
-- Run once against the production database, e.g.:
--   psql "postgresql://<user>:<pass>@<rds-host>/postgres" -f 2026-07-10-status-and-ota.sql
-- Every statement is idempotent (IF NOT EXISTS), so re-running is harmless.

-- 1. Relay boards now report their own liveness and physically-verified channel states
--    (piggybacked on the hub's 5-minute heartbeat).
ALTER TABLE relay_boards ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;
ALTER TABLE relay_boards ADD COLUMN IF NOT EXISTS reported_states TEXT;

-- 2. Power-cut visibility: one row per device cold boot, so the dashboard can show
--    when and where power was lost per site.
CREATE TABLE IF NOT EXISTS device_boot_logs (
    id SERIAL PRIMARY KEY,
    device_type TEXT NOT NULL,          -- 'CENTRAL_HUB' | 'MINI_NODE' | 'RELAY_BOARD'
    device_id TEXT NOT NULL,            -- hub_id, mininode_id, or relay_mac
    hub_id TEXT,
    boot_reason TEXT,                   -- 'POWER_ON' (timer wakes are not logged)
    firmware_version TEXT,
    logged_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boot_logs_hub_time ON device_boot_logs (hub_id, logged_at DESC);

-- 3. OTA firmware registry. One active row per device type; the hub polls
--    GET /api/firmware/latest and compares against its compiled FW_VERSION.
CREATE TABLE IF NOT EXISTS firmware_versions (
    id SERIAL PRIMARY KEY,
    device_type TEXT NOT NULL,          -- 'CENTRAL_HUB' | 'MINI_NODE' | 'RELAY_BOARD'
    version TEXT NOT NULL,              -- semantic, e.g. '1.1.0'
    url TEXT NOT NULL,                  -- direct .bin download URL (GitHub Release asset)
    sha256 TEXT NOT NULL,               -- lowercase hex digest of the .bin
    notes TEXT,
    released_at TIMESTAMP NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_firmware_lookup ON firmware_versions (device_type, active, released_at DESC);
