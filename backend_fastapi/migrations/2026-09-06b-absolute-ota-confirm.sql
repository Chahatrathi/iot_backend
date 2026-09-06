-- 2026-09-06b: absolute OTA confirmation (v2.3.0).
-- The hub reports: running_version (read from the flash app descriptor - what is
-- ACTUALLY executing) and sd_firmware (the depot image on the SD card: name,
-- size, sha256 - what is STORED). Cloud stores + surfaces both per hub.

ALTER TABLE central_nodes ADD COLUMN IF NOT EXISTS running_version TEXT;
ALTER TABLE central_nodes ADD COLUMN IF NOT EXISTS sd_firmware TEXT;
