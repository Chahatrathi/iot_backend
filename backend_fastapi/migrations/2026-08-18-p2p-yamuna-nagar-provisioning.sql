-- Migration: Yamuna Nagar P2P deployment — plant, POC user, 2 direct-upload mini nodes,
-- and 2 relay boards (one per node).
--
-- P2P deployments have NO central hub. Each mini node is its own gateway and POSTs to
-- /api/telemetry/ingest with hub_id = its own chip ID (node_type = "MINI_NODE"). For those
-- uploads to pass the ingest gate and the DB foreign keys, every node needs:
--   central_nodes  (hub_id = node chip ID, factory_id = this plant)  <- created here
--   mini_nodes     (mininode_id = node chip ID, hub_id = node chip ID) <- created here
--   relay_boards   (relay_mac = the node's relay board's real MAC)    <- created here
--
-- Everything is idempotent (ON CONFLICT / NOT EXISTS), so re-running in pgAdmin is harmless.
-- Run the statements top-down in pgAdmin (or run the file via `psql -f`).
--
-- IMPORTANT (channel wiring): the fan/bulb channel pairs below must match the PHYSICAL wiring
-- from each mini node to its relay board's terminals. The cloud mapping is authoritative — the
-- node adopts fan_relay_mac / fan_channel / bulb_channel from the ingest response on every
-- upload (applyCloudConfig). If your wiring differs, change the numbers here BEFORE running.

-- 1. Plant / factory (unique on name).
INSERT INTO factories (name, location)
VALUES ('Yamuna Nagar', 'Yamuna Nagar, Haryana')
ON CONFLICT (name) DO NOTHING;

-- 2. Per-node "hub" rows (hub_id = chip ID) so the ingest gate + hub FKs pass.
INSERT INTO central_nodes (hub_id, factory_id)
SELECT '3750700320', id FROM factories WHERE name = 'Yamuna Nagar'
ON CONFLICT (hub_id) DO NOTHING;

INSERT INTO central_nodes (hub_id, factory_id)
SELECT '3396281496', id FROM factories WHERE name = 'Yamuna Nagar'
ON CONFLICT (hub_id) DO NOTHING;

-- 3. The relay boards (each node has its own; relay_boards.hub_id points at that node's
--    chip ID — the ingest updates relay_boards purely by relay_mac, so this reference is
--    only for FK purposes).
INSERT INTO relay_boards (relay_mac, hub_id, factory_id)
SELECT '94:A9:90:2B:A6:04', '3750700320', id FROM factories WHERE name = 'Yamuna Nagar'
ON CONFLICT (relay_mac) DO NOTHING;

INSERT INTO relay_boards (relay_mac, hub_id, factory_id)
SELECT '94:A9:90:2B:A6:5C', '3396281496', id FROM factories WHERE name = 'Yamuna Nagar'
ON CONFLICT (relay_mac) DO NOTHING;

-- 4. Mini nodes (node_index is scoped per factory, matching onboarding.py logic).
--    Node 3750700320 drives relay 94:A9:90:2B:A6:04 (fan CH1 / bulb CH2).
INSERT INTO mini_nodes (mininode_id, hub_id, fan_relay_mac, bulb_relay_mac, fan_channel, bulb_channel, node_index)
SELECT '3750700320', '3750700320', '94:A9:90:2B:A6:04', '94:A9:90:2B:A6:04', 1, 2,
       COALESCE((
           SELECT MAX(m.node_index) + 1 FROM mini_nodes m
           JOIN central_nodes c ON m.hub_id = c.hub_id
           WHERE c.factory_id = f.id
       ), 1)
FROM factories f WHERE f.name = 'Yamuna Nagar'
ON CONFLICT (mininode_id) DO UPDATE
SET hub_id = EXCLUDED.hub_id,
    fan_relay_mac = EXCLUDED.fan_relay_mac,
    bulb_relay_mac = EXCLUDED.bulb_relay_mac,
    fan_channel = EXCLUDED.fan_channel,
    bulb_channel = EXCLUDED.bulb_channel;

--    Node 3396281496 drives relay 94:A9:90:2B:A6:5C (fan CH1 / bulb CH2).
INSERT INTO mini_nodes (mininode_id, hub_id, fan_relay_mac, bulb_relay_mac, fan_channel, bulb_channel, node_index)
SELECT '3396281496', '3396281496', '94:A9:90:2B:A6:5C', '94:A9:90:2B:A6:5C', 1, 2,
       COALESCE((
           SELECT MAX(m.node_index) + 1 FROM mini_nodes m
           JOIN central_nodes c ON m.hub_id = c.hub_id
           WHERE c.factory_id = f.id
       ), 1)
FROM factories f WHERE f.name = 'Yamuna Nagar'
ON CONFLICT (mininode_id) DO UPDATE
SET hub_id = EXCLUDED.hub_id,
    fan_relay_mac = EXCLUDED.fan_relay_mac,
    bulb_relay_mac = EXCLUDED.bulb_relay_mac,
    fan_channel = EXCLUDED.fan_channel,
    bulb_channel = EXCLUDED.bulb_channel;

-- 5. Plant POC account. Password is bcrypt-hashed (matching app/security.py::hash_password).
--    Login: test_ankit@gmail.com / Ankit@Yamuna
INSERT INTO users (factory_id, username, email, password_hash, role)
SELECT id, 'test_ankit', 'test_ankit@gmail.com', '$2b$12$lNoH.kmKQCU0CWIjp8q5xOJHC9F5XtT3W5.wKe0ps4BWdIv7C/YFC', 'PLANT_POC'
FROM factories f
WHERE f.name = 'Yamuna Nagar'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = 'test_ankit@gmail.com')
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = 'test_ankit');

-- 6. Verification (run manually afterwards, not part of provisioning):
-- SELECT f.name, c.hub_id, m.mininode_id, m.fan_relay_mac, m.fan_channel, m.bulb_channel, m.node_index, r.relay_mac
-- FROM factories f
-- LEFT JOIN central_nodes c ON c.factory_id = f.id
-- LEFT JOIN mini_nodes m ON m.hub_id = c.hub_id
-- LEFT JOIN relay_boards r ON r.factory_id = f.id
-- WHERE f.name = 'Yamuna Nagar'
-- ORDER BY m.node_index;