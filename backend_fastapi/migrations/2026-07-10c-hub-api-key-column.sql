-- Migration: forward-looking column for per-hub API keys.
-- Not read or written by any code yet — the backend still verifies HUB_API_KEY as a single
-- global secret (app/security.py::verify_hub_key). This column exists now so that migrating
-- to per-hub keys later is an ALTER + a code change, not a schema redesign.
--
-- When that migration happens: generate a random key per hub at provisioning time, store only
-- its hash here (bcrypt, same as user passwords — never the plaintext key), hand the plaintext
-- to the installer once (e.g. via the WiFi captive portal, alongside the WiFi password), and
-- change verify_hub_key to look up hub_id from the request body and check against this column
-- instead of the single HUB_API_KEY env var.

ALTER TABLE central_nodes ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
