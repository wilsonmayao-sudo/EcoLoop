# Ecoloop Project Structure

This document describes the cleaned project layout after reorganizing the WebApp, MobileApp, database scripts, and configuration files.

## Root

```text
Ecoloop/
├── README.md
├── PROJECT_STRUCTURE.md
├── .gitignore
├── WebApp/
├── MobileApp/
└── database/
```

- `README.md` - Project overview, setup, and team information.
- `PROJECT_STRUCTURE.md` - Maintained map of the production project layout.
- `.gitignore` - Ignores dependencies, build outputs, Expo artifacts, logs, and local env files.
- `WebApp/` - Staff web dashboard for admins, dispatchers, and supervisors.
- `MobileApp/` - Expo mobile app for truck drivers.
- `database/` - Supabase schema, RLS, triggers, seed data, and archived legacy SQL.

## WebApp

```text
WebApp/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── .env.example
├── README.md
└── src/
    ├── app/
    │   ├── App.tsx
    │   └── main.tsx
    ├── assets/
    │   └── icons/
    │       ├── ecoloopLogo.ts
    │       └── sidebarLogo.ts
    ├── components/
    │   ├── feedback/
    │   │   ├── ConfirmModal.tsx
    │   │   ├── NotificationDropdown.tsx
    │   │   └── Toast.tsx
    │   └── layout/
    │       └── Sidebar.tsx
    ├── contexts/
    │   └── AuthContext.tsx
    ├── features/
    │   └── auth/
    │       ├── LoginPageFunctional.tsx
    │       ├── RegisterPageFunctional.tsx
    │       └── WelcomeScreen.tsx
    ├── hooks/
    │   └── useLiveData.ts
    ├── pages/
    │   ├── BinLocations.tsx
    │   ├── Notifications.tsx
    │   ├── ProfessionalDashboard.tsx
    │   ├── ReportsAndIssues.tsx
    │   ├── RoutePlanning.tsx
    │   ├── SupervisorDashboard.tsx
    │   ├── SystemSettings.tsx
    │   ├── UserApprovals.tsx
    │   └── VehicleMonitoringWithActions.tsx
    ├── services/
    │   └── supabaseClient.ts
    ├── styles/
    │   └── globals.css
    ├── utils/
    │   └── routing/
    │       ├── astar.ts
    │       ├── buildGraph.ts
    │       ├── geo.ts
    │       ├── optimizeMultiStop.ts
    │       └── types.ts
    └── index.css
```

- `src/app/App.tsx` - Web application shell, page routing, auth guard, and role-aware navigation.
- `src/app/main.tsx` - Vite bootstrap entry.
- `src/pages/` - Page-level screens rendered by the web shell.
- `src/features/auth/` - Authentication and registration UI.
- `src/components/layout/` - Shared layout components such as the sidebar.
- `src/components/feedback/` - Modals, toasts, and notification dropdown UI.
- `src/hooks/useLiveData.ts` - Supabase live data access, realtime subscriptions, formatting helpers, and domain record types.
- `src/services/supabaseClient.ts` - Supabase browser client configuration.
- `src/utils/routing/` - Routing, graph, distance, and optimization helpers.

## MobileApp

```text
MobileApp/
├── App.js
├── app.config.js
├── app.json
├── babel.config.js
├── package.json
├── package-lock.json
├── .env.example
├── README.md
└── src/
    ├── app/
    │   ├── ErrorBoundary.js
    │   ├── navigation/
    │   │   ├── RootNavigator.js
    │   │   └── TabNavigator.js
    │   └── providers/
    │       └── AppProviders.js
    ├── components/
    │   └── ui/
    │       ├── ActionPill.js
    │       ├── Header.js
    │       ├── StatCard.js
    │       └── TagChip.js
    ├── context/
    │   ├── AuthContext.js
    │   ├── AvatarContext.js
    │   ├── CompletedRoutesContext.js
    │   ├── LanguageContext.js
    │   ├── NotificationContext.js
    │   ├── PickupContext.js
    │   └── ThemeContext.js
    ├── lib/
    │   └── supabase.js
    ├── screens/
    │   ├── AboutEcoloopScreen.js
    │   ├── HelpSupportScreen.js
    │   ├── HomeScreen.js
    │   ├── LanguageScreen.js
    │   ├── LoginScreen.js
    │   ├── MapNavigateScreen.js
    │   ├── PrivacySecurityScreen.js
    │   ├── ProfileScreen.js
    │   ├── ReportsScreen.js
    │   └── SettingsScreen.js
    ├── services/
    │   └── offlineSync.js
    └── theme.js
```

- `App.js` - Thin Expo entry that mounts providers and root navigation.
- `src/app/providers/AppProviders.js` - Central provider composition for auth, data, theme, language, notifications, avatar, and safe area.
- `src/app/navigation/RootNavigator.js` - Auth-gated stack navigation.
- `src/app/navigation/TabNavigator.js` - Main truck-driver bottom tab navigation.
- `src/context/AuthContext.js` - Supabase Auth session, truck-driver profile validation, and driver record loading.
- `src/context/PickupContext.js` - Assigned pickup loading, realtime refresh, cache, and offline completion queue integration.
- `src/lib/supabase.js` - Mobile Supabase client using Expo config and AsyncStorage session persistence.
- `src/services/offlineSync.js` - Offline mutation queue helpers.
- `src/components/ui/` - Reusable mobile UI primitives shared across screens.

## Database

```text
database/
├── seed.sql
```

- `migrations/001_core_tables.sql` - Auth profiles, truck drivers, bins, routes, route stops, and deliveries.
- `migrations/002_live_data_tables.sql` - Vehicles, reports, notifications, reference data tables, settings, and permissions tables.
- `migrations/003_functions_triggers.sql` - Supabase auth trigger for profile/driver creation and updated-at triggers.
- `migrations/004_rls_policies.sql` - Row Level Security policies for staff and truck-driver access.
- `seed.sql` - Default settings, role permissions, and reference rows.
- `archive/supabase_live_data.sql` - Legacy all-in-one SQL kept for comparison only.

## Configuration

- `WebApp/.env.example` documents `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `MobileApp/.env.example` documents `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `OPENROUTE_API_KEY`.
- `WebApp/vite.config.ts` contains only Vite, React, Tailwind, and the `@` source alias.
- `MobileApp/app.config.js` maps Expo public env vars into runtime config.

## Notes For Future Work

- Add new WebApp page-level views under `WebApp/src/pages`.
- Add reusable WebApp UI under `WebApp/src/components`.
- Add MobileApp screens under `MobileApp/src/screens` and reusable mobile UI under `MobileApp/src/components/ui`.
- Add Supabase schema changes as new ordered files in `database/migrations`.
