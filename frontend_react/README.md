# Frontend — React Dashboard

Vite + React + Tailwind SPA, deployed on Vercel as a separate project from the backend. No
server-side rendering; everything is client-fetched from the FastAPI API.

## Layout

| File | Contents |
|---|---|
| `src/App.jsx` | API base URL switch (localhost vs. production), session persistence, `authFetch` helper. |
| `src/components/LoginView.jsx` | Login form — the only screen that calls the API without a token. |
| `src/components/DashboardContainer.jsx` | Header/nav, routes between fleet view and device drill-down. |
| `src/components/PlantOverview.jsx` | Fleet view. Two very different renders depending on role (see below). |
| `src/components/DeviceTelemetry.jsx` | Per-tank drill-down: charts, thresholds, calibration, the commissioning sweep wizard, Master OFF. |
| `src/components/HardwareHubModal.jsx` | SUPER_ADMIN-only provisioning forms (factory, user, topology). |

## Auth flow

1. `LoginView` posts credentials to `POST /api/login`, gets back `{ access_token, user }`.
2. `App.jsx` stores both in `localStorage` under `iot_control_session`, wrapped with a client-side
   8-hour expiry check (independent of the JWT's own expiry, which the backend also enforces).
3. Every subsequent request goes through `authFetch(session, url, options)` (exported from
   `App.jsx`), which attaches `Authorization: Bearer <token>` and forces a logout + reload if the
   server ever responds `401` (expired or invalid token).
4. `session` is passed down as a prop through `DashboardContainer` → `PlantOverview` /
   `DeviceTelemetry` / `HardwareHubModal` — any new component that calls the API needs `session`
   passed to it and should use `authFetch`, not a bare `fetch`.

## Role-driven rendering

`PlantOverview` branches almost entirely on role:

- **`SUPER_ADMIN` / `LCB_TEAM`** (`isAdmin`): both get the global fleet map ("Live Activity Map")
  across all plants. That's the only thing actually shared — see the gap below.
- **`SUPER_ADMIN` only** (`isSuperAdmin`): everything else that isn't the live map. The tab
  switcher that reaches "All Infrastructure Plants" / "Team Access Directory" is gated
  `isSuperAdmin`, not `isAdmin` (`PlantOverview.jsx` line 337) — and since the per-plant topology
  tree, hardware hot-swap controls, POC account management, and the bulk provisioning calculator
  only render inside that tab's plant-drawer, `LCB_TEAM` currently has no UI path to any of them.
  The "Provision Core Role" and "View RBAC Matrix" buttons are likewise `isSuperAdmin`-gated
  (lines 324–335). Also `isSuperAdmin` only: the "Manage Hardware" modal, global core-account
  provisioning, and — inside `DeviceTelemetry` — the polling-interval card and the commissioning
  sweep wizard.
- **`PLANT_POC`**: scoped to their own `factory_id`, read-only fleet view + a plain-language
  notification feed. No edit controls render at all.

**Known gap**: per [`CLAUDE.md`](../../../CLAUDE.md), `LCB_TEAM` is supposed to have "all plants,
thresholds/relays, no provisioning" — parity with `SUPER_ADMIN` minus provisioning. The tab-bar
gating above means that, in practice, `LCB_TEAM` can currently only see the live fleet map and
can't reach the plant list, topology tree, or hot-swap/provisioning-calculator screens at all
(provisioning was never meant to be theirs, but the *read* access to topology was). Whether this
is a bug to fix (loosen the tab gating to `isAdmin` where the underlying action is itself
`LCB_TEAM`-permitted) or the current intended state is an open question — check with Akash
before changing the gating.

These are UI conveniences, not the security boundary — the backend re-checks role and factory
scope on every request (see [`backend_fastapi/README.md`](../backend_fastapi/README.md#auth-model)).
A `PLANT_POC` token will get a real `403` from the API even if a button were somehow clicked.

## Connectivity status heuristic

Both `PlantOverview` and `DeviceTelemetry` compute LIVE / CAUTION / INTERRUPTED client-side from
`hub_last_seen` / `node_last_seen` timestamps: no hub contact for 30 minutes → hub offline
(red); hub alive but a specific tank silent for 30 minutes → node offline (yellow); otherwise
live (green).

## Known pre-existing gaps (not addressed here)

- `HardwareHubModal`'s "View RBAC Matrix Table" calls `GET /api/users`, which the backend doesn't
  expose — see the backend README's matching note.
- No test suite; verification here has been manual/read-through only.
