-- Migration: SPN Agrotech (Yamuna Nagar) P2P deployment — plant, POC user, 2 direct-upload
-- mini nodes, and 2 relay boards (one per node).
--
-- P2P deployments have NO central hub. Each mini node is its own gateway and POSTs to
-- /api/telemetry/ingest with hub_id = its own chip ID (node_type = "MINI_NODE"). For those
-- uploads to pass the ingest gate and the DB foreign keys, every node needs:
--   central_nodes  (hub_id = node chip ID, factory_id = this plant)
--   mini_nodes     (mininode_id = node chip ID, hub_id = node chip ID)
--   relay_boards   (relay_mac = the node's relay board's real MAC)
--
-- This file SUPERSEDES 2026-08-18-p2p-yamuna-nagar-provisioning.sql for the same hardware:
-- it repoints nodes 3396281496 / 3750700320 (and relay 94:A9:90:2B:A6:5C) to the SPN Agrotech
-- plant and corrects their relay wiring. All statements are idempotent (ON CONFLICT ... DO
-- UPDATE), so re-running is harmless whether or not the earlier file already ran.
--
-- IMPORTANT (channel wiring): the fan/bulb channel pairs below must match the PHYSICAL wiring
-- from each mini node to its relay board's terminals. The cloud mapping is authoritative — the
-- node adopts fan_relay_mac / fan_channel / bulb_channel from the ingest response on every
-- upload (applyCloudConfig). If your wiring differs, change the numbers here BEFORE running.

-- 1. Plant / factory (unique on name).
INSERT INTO factories (name, location)
VALUES ('SPN Agrotech', 'Yamuna Nagar')
ON CONFLICT (name) DO NOTHING;

-- 2. Per-node "hub" rows (hub_id = chip ID) so the ingest gate + hub FKs pass.
--    These already exist under the superseded "Yamuna Nagar" plant, so DO UPDATE repoints them
--    here (a chip ID is a physical device — it can belong to only one plant).
INSERT INTO central_nodes (hub_id, factory_id)
SELECT '3396281496', id FROM factories WHERE name = 'SPN Agrotech'
ON CONFLICT (hub_id) DO UPDATE SET factory_id = EXCLUDED.factory_id;

INSERT INTO central_nodes (hub_id, factory_id)
SELECT '3750700320', id FROM factories WHERE name = 'SPN Agrotech'
ON CONFLICT (hub_id) DO UPDATE SET factory_id = EXCLUDED.factory_id;

-- 3. The relay boards. 94:A9:90:2B:A6:5C already exists (was wired to 3396281496 in the
--    superseded migration) — repoint it to 3750700320. 94:A9:90:2B:A6:F8 is new.
INSERT INTO relay_boards (relay_mac, hub_id, factory_id)
SELECT '94:A9:90:2B:A6:F8', '3396281496', id FROM factories WHERE name = 'SPN Agrotech'
ON CONFLICT (relay_mac) DO UPDATE SET hub_id = EXCLUDED.hub_id, factory_id = EXCLUDED.factory_id;

INSERT INTO relay_boards (relay_mac, hub_id, factory_id)
SELECT '94:A9:90:2B:A6:5C', '3750700320', id FROM factories WHERE name = 'SPN Agrotech'
ON CONFLICT (relay_mac) DO UPDATE SET hub_id = EXCLUDED.hub_id, factory_id = EXCLUDED.factory_id;

-- 4. Mini nodes. Both exist under the superseded plant, so DO UPDATE rewires them here.
--    Node 3396281496 drives relay 94:A9:90:2B:A6:F8 (fan CH3 / bulb CH6).
INSERT INTO mini_nodes (mininode_id, hub_id, fan_relay_mac, bulb_relay_mac, fan_channel, bulb_channel, node_index)
SELECT '3396281496', '3396281496', '94:A9:90:2B:A6:F8', '94:A9:90:2B:A6:F8', 3, 6,
       COALESCE((
           SELECT MAX(m.node_index) + 1 FROM mini_nodes m
           JOIN central_nodes c ON m.hub_id = c.hub_id
           WHERE c.factory_id = f.id
       ), 1)
FROM factories f WHERE f.name = 'SPN Agrotech'
ON CONFLICT (mininode_id) DO UPDATE
SET hub_id = EXCLUDED.hub_id,
    fan_relay_mac = EXCLUDED.fan_relay_mac,
    bulb_relay_mac = EXCLUDED.bulb_relay_mac,
    fan_channel = EXCLUDED.fan_channel,
    bulb_channel = EXCLUDED.bulb_channel;

--    Node 3750700320 drives relay 94:A9:90:2B:A6:5C (fan CH2 / bulb CH3).
INSERT INTO mini_nodes (mininode_id, hub_id, fan_relay_mac, bulb_relay_mac, fan_channel, bulb_channel, node_index)
SELECT '3750700320', '3750700320', '94:A9:90:2B:A6:5C', '94:A9:90:2B:A6:5C', 2, 3,
       COALESCE((
           SELECT MAX(m.node_index) + 1 FROM mini_nodes m
           JOIN central_nodes c ON m.hub_id = c.hub_id
           WHERE c.factory_id = f.id
       ), 1)
FROM factories f WHERE f.name = 'SPN Agrotech'
ON CONFLICT (mininode_id) DO UPDATE
SET hub_id = EXCLUDED.hub_id,
    fan_relay_mac = EXCLUDED.fan_relay_mac,
    bulb_relay_mac = EXCLUDED.bulb_relay_mac,
    fan_channel = EXCLUDED.fan_channel,
    bulb_channel = EXCLUDED.bulb_channel;

-- 5. Plant POC account. Password is bcrypt-hashed (matching app/security.py::hash_password).
--    Login: er.ankitsharma@gmail.com / Ankit@Yamuna
INSERT INTO users (factory_id, username, email, password_hash, role)
SELECT id, 'ankit_sharma', 'er.ankitsharma@gmail.com', '$2b$12$lNoH.kmKQCU0CWIjp8q5xOJHC9F5XtT3W5.wKe0ps4BWdIv7C/YFC', 'PLANT_POC'
FROM factories f
WHERE f.name = 'SPN Agrotech'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = 'er.ankitsharma@gmail.com')
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = 'ankit_sharma');

-- 6. Verification (run manually afterwards, not part of provisioning):
-- SELECT f.name, c.hub_id, m.mininode_id, m.fan_relay_mac, m.fan_channel, m.bulb_channel, m.node_index, r.relay_mac
-- FROM factories f
-- LEFT JOIN central_nodes c ON c.factory_id = f.id
-- LEFT JOIN mini_nodes m ON m.hub_id = c.hub_id
-- LEFT JOIN relay_boards r ON r.factory_id = f.id
-- WHERE f.name = 'SPN Agrotech'
-- ORDER BY m.node_index;
