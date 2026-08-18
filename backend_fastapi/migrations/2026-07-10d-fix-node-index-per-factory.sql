-- Migration: node_index ("Tank #N" in the UI) must be scoped per factory, not a single global
-- auto-increment across every mini_node ever created. Symptom this fixes: a plant's first-ever
-- tank displaying as "Tank #9" because it happened to be the 9th mini_node row inserted
-- system-wide, not because 8 other tanks exist at that plant.

-- 1. Renumber every existing mini_node so node_index restarts at 1 for each factory, preserving
--    each factory's existing relative order (so BioSanjeevni's Tank #1..#8 stay exactly as they
--    are — this only changes numbering for factories sharing the old global sequence with them).
WITH renumbered AS (
    SELECT m.mininode_id,
           ROW_NUMBER() OVER (PARTITION BY c.factory_id ORDER BY m.node_index) AS new_index
    FROM mini_nodes m
    JOIN central_nodes c ON m.hub_id = c.hub_id
)
UPDATE mini_nodes m
SET node_index = r.new_index
FROM renumbered r
WHERE m.mininode_id = r.mininode_id;

-- 2. Drop the global-sequence default. Every INSERT now supplies node_index explicitly
--    (see app/routers/onboarding.py) — removing the default means a future code path that
--    forgets to do so fails loudly (NOT NULL violation) instead of silently reintroducing
--    this exact bug.
ALTER TABLE mini_nodes ALTER COLUMN node_index DROP DEFAULT;
