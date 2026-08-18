-- Migration: per-device firmware version tracking for mini nodes and relay boards.
-- (central_nodes.firmware_version already exists.) From hub firmware 1.3.0, mini
-- nodes report their version inside each sensor packet and relay boards inside
-- their 60-second status message; the hub forwards both on ingest/heartbeat.
-- Run once against the production database, e.g.:
--   psql "postgresql://<user>:<pass>@<rds-host>/postgres" -f 2026-07-20-device-firmware-versions.sql
-- Every statement is idempotent (IF NOT EXISTS), so re-running is harmless.

ALTER TABLE mini_nodes ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE relay_boards ADD COLUMN IF NOT EXISTS firmware_version TEXT;
