# Ecoloop WebApp

React/Vite staff dashboard for Ecoloop dispatchers, supervisors, and admins.

## Setup

Copy [`.env.example`](.env.example) to `.env.local` (or `.env`) and fill in the values:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# Optional — street route geometries + Mapbox map rendering
VITE_MAPBOX_ACCESS_TOKEN=
```

### Mapbox (optional)

1. Create an account at [mapbox.com](https://www.mapbox.com/).
2. In [Access tokens](https://account.mapbox.com/access-tokens/), create a **public** token (`pk.`…).
3. Add `VITE_MAPBOX_ACCESS_TOKEN=pk.your...` to `.env.local`.
4. In the token’s settings, **restrict URLs** to your dev server (e.g. `http://localhost:3000`) and production origin.

**What it does in this app:**

- **Street Routing & Previews:** fetches road geometries via the Mapbox Directions API (`driving-traffic`) with an automatic OSRM/cached fallback when unavailable.
- **Map Views:** renders interactive `mapbox-gl` maps in Route Planning, Area Management, and Live Monitoring.

Install and run:

```bash
npm install
npm run dev
```

## Structure

- `src/app` - WebApp shell and bootstrap entry.
- `src/pages` - Dashboard, route planning, area management, live monitoring, reports, notifications, users, and system settings pages.
- `src/components` - Shared layout, UI, maps, fleet, overflow, settings, and feedback components.
- `src/features/auth` - Login, registration, and welcome/auth screens.
- `src/hooks` - Live Supabase data and overflow dispatch hooks.
- `src/services` - Supabase client, street routing, and route assignment services.
- `src/utils` - Routing, overflow reassignment, schedule, and settings utilities.