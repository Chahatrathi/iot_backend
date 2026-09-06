-- 2026-09-06: firmware manifest size field.
-- The hub (central_node >= 2.2.2) uses `size` to stage OTA images on SD
-- without a HEAD probe (the HEAD probe rides the WiFi stack and cannot run
-- when the hub is on the SIM network only). Optional in publish; returned by
-- /api/firmware/latest.

ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS size BIGINT;
