# Backend — FastAPI on Vercel

Serverless FastAPI app, one deployment, talking to a single Postgres database (AWS RDS) over
`asyncpg`. No ORM models — every query is hand-written SQL via SQLAlchemy's async `text()`.

## Layout

| File | Contents |
|---|---|
| `app/main.py` | App instance, CORS, login, account bootstrap/registration, health check. |
| `app/config.py` | DB engine + required environment variables (fails closed if any are missing). |
| `app/security.py` | JWT issuing/verification, role-gating dependencies, Hub API key check. |
| `app/schemas.py` | Pydantic request schemas for the onboarding router. |
| `app/routers/onboarding.py` | Factories, users, hardware topology, bulk provisioning, hot-swap. |
| `app/routers/telemetry.py` | The core ingest/acknowledge loop, heartbeats, per-device config, calibration, commissioning sweep. |
| `app/routers/firmware.py` | OTA manifest: latest-version lookup (hub-key auth) + release publishing (SUPER_ADMIN). |
| `migrations/` | Idempotent SQL to run against the database when the schema changes — run in filename order. |
| `scripts/apply_migrations.py` | Applies every `migrations/*.sql` in filename order, tracking applied files in `schema_migrations`; safe to re-run. |
| `scripts/smoke_test.py` | Post-deployment verification — runs the auth/scoping/hub-key checks against a live URL. |

## Migrations

Schema changes live as idempotent SQL in `migrations/` (filename order = application
order; suffix letters disambiguate same-day files, e.g. `2026-08-11a-invoicing.sql` then
`2026-08-11b-invoicing-seed.sql` — the seed *must* run after the tables it fills).
Apply them with:

```
python scripts/apply_migrations.py --dry-run   # list what's pending, no changes
python scripts/apply_migrations.py             # apply, using POSTGRES_URL_ASYNC
```

The runner creates a `schema_migrations` table, runs each pending file in its own
transaction, and records it — so re-running applies only what's new. It needs just
`POSTGRES_URL_ASYNC` (from the environment or a `.env`/`.env.local` in this folder),
not the other app env vars.

The invoicing seed (`2026-08-11b-invoicing-seed.sql`) is generated from the offline
data at `D:\opencode\invoices` by `scripts/build_invoice_seed_sql.py` — regenerate it
whenever that data changes, then re-apply (upserts, so it's harmless).

## The ingest contract (device-facing heart of the system)

`POST /api/telemetry/ingest` (hub-key auth) accepts telemetry batches **and** heartbeats — a
heartbeat is the same payload with an empty `readings` array, sent every 5 minutes. The payload
optionally carries `event` ("BOOT" on the hub's first call after power-up), `firmware_version`,
`relay_status` (per-relay channel states + uptime, stored on `relay_boards`), and per-reading
`boot_reason` (mini node cold boots). Cold boots of any device are logged to `device_boot_logs`.

The response always includes, besides the command queue: `desired_states` (the authoritative
fan/bulb state per relay channel — what the hub uses to restore relays after power cuts) and
`edge_rules` enriched with relay mapping, moisture calibration values, and `node_index` (what
the hub uses to act autonomously when the internet is down, and to label tanks on its local
status portal). On heartbeats these cover every node under the
hub; on telemetry batches, the reporting nodes. `telemetry_interval_ms` is clamped to a
15-minute ceiling server-side. Each hub's `firmware_version` is written to `central_nodes` on
every call that reports one.

## P2P deployments (no central hub — mini nodes upload directly)

Firmware: `hardware code/mini_node_p2p` / `hardware code/relay_board_p2p`. In these deployments
there is no central node: every mini node is its own gateway and POSTs the same `/api/telemetry/ingest`
payload with `hub_id` = its own chip ID and `node_type: "MINI_NODE"`. To support this without
touching the hub flow:

- The node must be provisioned as its **own `central_nodes` row** (`hub_id` = chip ID) so the
  ingest gate and the hub foreign keys pass. The relay board it commands must be a `relay_boards`
  row (real MAC), and the tank a `mini_nodes` row with `mininode_id` = chip ID.
- The ingest detects `node_type == "MINI_NODE"` and skips the hub-only dispatch machinery:
  the CENTRAL_HUB boot log, the `desired_states` snapshot, and the autonomous command queue
  (P2P nodes decide fan/bulb states on-device and apply them over the mesh, so they never pull
  queued commands). Telemetry, relay status, calibration, EMA moisture, and the `edge_rules`
  response are unchanged — that response is what the node uses to adopt cloud config.
- Provision new P2P deployments with `POST /api/onboard/p2p-provision` (SUPER_ADMIN) or the
  seed migration `migrations/2026-08-18-p2p-yamuna-nagar-provisioning.sql`.

Because each node is its own `central_nodes` row, the fleet pages list one "Central Hub" per
node (its chip ID). This is cosmetic; node telemetry, thresholds, and calibration behave exactly
like the hub-backed flow. Known P2P limitation: dashboard-originated relay actions (master-off,
commissioning sweep pulse) still write to `relay_commands_queue`, which P2P nodes never read —
actuator control in P2P is fully local to the mesh.

## Schema reconciliation note (2026-07-10)

A production schema dump surfaced a real mismatch: `relay_execution_acks`' actual columns
(`relay_id, relay_mac, channel, state, status, logged_at`) didn't include the ones
`acknowledge_commands()` and `get_device_history()` write/read (`command_id, hub_id,
execution_status, executed_at`) — meaning every acknowledge call was very likely 500ing before
this was caught. Fixed by migration, not code change: see
`migrations/2026-07-10b-relay-acks-and-fw-version.sql`. If you add a new column reference
anywhere in `telemetry.py` or `onboarding.py`, verify it against a fresh schema dump first —
the ORM-less, hand-written-SQL style here has no compile-time check that a column exists.

**Second one, same day**: `mini_nodes.node_index` (displayed as "Tank #N") was defaulting to
`nextval(mini_nodes_node_index_seq)` — one sequence shared by the entire table, not one per
factory. A brand-new plant's first tank showed as "Tank #9" because it was the 9th mini_node
row ever inserted system-wide. Fixed in `migrations/2026-07-10d-fix-node-index-per-factory.sql`
(renumbers existing rows per-factory, drops the sequence default) plus a code change in all
three `mini_nodes`-inserting routes in `onboarding.py` — each now computes
`node_index = MAX(node_index) + 1` scoped to `WHERE central_nodes.factory_id = :factory_id`
instead of relying on the column default. If you add a fourth place that inserts a mini_node,
it must do the same or this bug comes back for that path specifically.

**Third, same day, and revisited since**: `acknowledge_commands()` in `telemetry.py` actually
handles two different ack payload shapes, distinguished by whether `"relay_chip_id"` is present:
a hardware-ack shape (writes `relay_id, relay_mac, channel, state, status, hub_id,
execution_status, executed_at` — no `command_id`) and a legacy queue-completion shape (writes
only `command_id, hub_id, execution_status, executed_at`). Since each shape omits different
columns, migration `2026-07-10b-relay-acks-and-fw-version.sql` (adding `command_id, hub_id,
execution_status, executed_at`) wasn't sufficient on its own — a later migration,
`2026-07-10e-relay-acks-accept-hardware-shape.sql`, had to drop `NOT NULL` from the original
`relay_id`, `channel`, and `state` columns so the legacy-shape insert wouldn't violate a
constraint. If you touch `acknowledge_commands()` again, check both branches — a schema
assumption that holds for one ack shape can break the other.

## Hub authentication roadmap

Today `HUB_API_KEY` is one global secret, identical across every Central Hub — simplest to
operate, but rotating it (e.g. after a hub is decommissioned or its key leaks) means reflashing
the whole fleet. `central_nodes.api_key_hash` (migration `2026-07-10c-hub-api-key-column.sql`)
is a placeholder column for a future per-hub key scheme, not wired to any code yet. When that's
built: generate a random key per hub at provisioning time, store its hash (never plaintext),
hand the plaintext to the installer once via the WiFi captive portal, and change
`verify_hub_key` to look up the specific hub from the request body instead of comparing against
one shared env var.

## Auth model

Login (`POST /api/login`) returns a signed JWT (`access_token`) alongside the user object, valid
8 hours. Every protected route requires `Authorization: Bearer <token>` and is gated one of three
ways (see `app/security.py`):

- **`require_roles(*roles)`** — 403s unless the token's role is in the list. Used across
  `onboarding.py` and `telemetry.py` write/admin routes.
- **`get_current_user`** — just requires a valid token, any role. Used for reads.
- **`assert_factory_scope(user, factory_id)`** — additionally checks a `PLANT_POC` token's
  `factory_id` claim matches the resource being accessed; admins (`SUPER_ADMIN`, `LCB_TEAM`)
  bypass this check.
- **`verify_hub_key`** — separate, non-user auth for the two device-facing routes
  (`/api/telemetry/ingest`, `/api/telemetry/acknowledge`). The Central Hub firmware has no user
  identity, so it presents a static `X-Hub-Key` header instead, checked against `HUB_API_KEY`.

### Role → route matrix

| Role | Fleet read | Mesh write (thresholds, relays, calibration) | User/hardware provisioning |
|---|---|---|---|
| `SUPER_ADMIN` | All plants | Yes | Yes (global + per-plant) |
| `LCB_TEAM` | All plants | Yes | No |
| `PLANT_POC` | Own factory only | No | No |

### Account bootstrap

`POST /api/absolute-diagnostic-register` creates a user directly (bcrypt-hashed password). If the
`users` table is empty, it's reachable with no token at all — that's the only way to create the
first `SUPER_ADMIN` account on a brand-new deployment. The moment one user exists, it requires a
valid `SUPER_ADMIN` bearer token, same as everything else under `/api/onboard`.

## Required environment variables

The app refuses to start if any of these are missing — there is deliberately no hardcoded
fallback for any of them.

| Variable | Used for |
|---|---|
| `POSTGRES_URL_ASYNC` | `postgresql+asyncpg://...` connection string. |
| `SECRET_KEY` | Signs and verifies JWTs. Rotating it invalidates every existing session. |
| `HUB_API_KEY` | Shared secret the Central Hub firmware presents on telemetry uploads — must match the `HUB_API_KEY` constant compiled into `hardware code/central_node/central_node.ino`. |

Set these in the Vercel project's environment variables for production, and in your shell (or a
local `.env`/`.env.local` loaded by your run command) for local development.

## Password hashing

Bcrypt only, called directly (`bcrypt.hashpw`/`bcrypt.checkpw` in `app/security.py`) — not via
`passlib`. Passlib was deliberately dropped: its 1.7.4 `CryptContext` reads `bcrypt.__about__`,
an attribute the `bcrypt` package removed in 4.1+, which broke hashing outright. Two legacy paths
that used to exist — a raw SHA-256 fallback and a `DIAGNOSTIC_VERIFIED_`-prefixed plaintext
bypass — have been removed. Any account whose `password_hash` predates this change will fail to
log in and needs its password reset via `PUT /api/onboard/update-password` (SUPER_ADMIN only).

## Known pre-existing gaps (not addressed here)

- `GET /api/users`, called by the frontend's `HardwareHubModal`, does not exist as a route in
  this backend — that fetch will 404 until either the route is added or the frontend call is
  pointed at `GET /api/onboard/directory-with-plants` instead.
- `GET /device/{mininode_id}/history` (telemetry.py) only requires `get_current_user` — it does
  **not** call `assert_factory_scope`. Any authenticated role, including `PLANT_POC`, can read
  the ack/execution history of a device belonging to a different factory. Every other
  `PLANT_POC`-reachable read route enforces factory scope; this one doesn't yet.
- No automated tests exist for any router.
