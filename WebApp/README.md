# Ecoloop WebApp

React/Vite staff dashboard for Ecoloop dispatchers, supervisors, and admins.

## Setup

Copy [`.env.example`](.env.example) to `.env` and fill in the values:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# Optional — traffic-aware route optimization + Mapbox map in Route Planning
VITE_MAPBOX_ACCESS_TOKEN=
```

### Mapbox (optional)

1. Create a free account at [mapbox.com](https://www.mapbox.com/).
2. In [Access tokens](https://account.mapbox.com/access-tokens/), create a **public** token (`pk.`…).
3. Add `VITE_MAPBOX_ACCESS_TOKEN=pk.your...` to `.env`.
4. In the token’s settings, **restrict URLs** to your dev server (e.g. `http://localhost:3000`) and production origin.

**What it does in this app:**

- **Route Planning:** stop order for new routes uses the [Directions Matrix API](https://docs.mapbox.com/api/navigation/matrix/) profile `driving-traffic` (pairwise **durations**), up to **25** coordinates per request; larger routes fall back to haversine distances.
- **Route map modal:** shows a Mapbox **navigation-day** style map (traffic). Without a token, the modal falls back to an OpenStreetMap embed.

Install and run:

```bash
npm install
npm run dev
```

## Structure

- `src/app` - WebApp shell and bootstrap entry.
- `src/pages` - Dashboard, route planning, reports, bins, notifications, approvals, and settings pages.
- `src/components` - Shared layout and feedback components.
- `src/features/auth` - Login, registration, and welcome/auth screens.
- `src/hooks` - Live Supabase data hooks.
- `src/services` - Supabase client setup.
- `src/utils` - Routing and map utility functions.