# Run Ecoloop on a new device

Step-by-step setup for a **fresh machine** (Windows, macOS, or Linux). Use the sections below as dropdowns: click each heading to expand.

<details>
<summary><strong>1. Prerequisites</strong></summary>

- **Git** — to clone the repository.
- **Node.js** — install the current **LTS** from [nodejs.org](https://nodejs.org/) (npm is included).
- **Web app only:** a modern browser; Vite serves at **http://localhost:3000** by default.
- **Mobile app (optional):**
  - **Expo Go** on a physical phone ([Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent) / [App Store](https://apps.apple.com/app/expo-go/id982107779)), or
  - **Android:** Android Studio + emulator, or
  - **iOS (macOS only):** Xcode + Simulator.

Verify Node and npm:

```bash
node -v
npm -v
```

</details>

<details>
<summary><strong>2. Get the code</strong></summary>

```bash
git clone <your-repository-url>
cd Ecoloop
```

Replace `<your-repository-url>` with your team’s Git remote.

</details>

<details>
<summary><strong>3. Supabase and environment variables</strong></summary>

Both the **WebApp** and **MobileApp** talk to **Supabase** (Auth + Postgres). You need:

- Project **URL** (`https://….supabase.co`)
- **anon** public API key (from Supabase Dashboard → Project Settings → API)

**WebApp** — in `WebApp/`, create a file named `.env` or `.env.local` (both are gitignored) with:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Optional (traffic-aware routing and Mapbox map in Route Planning):

```env
VITE_MAPBOX_ACCESS_TOKEN=pk.your_public_mapbox_token
```

**MobileApp** — create `MobileApp/.env` or `MobileApp/.env.local` with at minimum:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Optional:

```env
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_token
OPENROUTE_API_KEY=your_openrouteservice_key
```

The mobile `app.config.js` can also pick up `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_MAPBOX_ACCESS_TOKEN` from **`WebApp/.env.local`**, so configuring only the web env is enough for local dev if both apps live in the same clone.

**Database schema** — if you are standing up a **new** Supabase project, apply the SQL in `database/migrations/` in numeric order, then run `database/seed.sql`. See `database/README.md`.

</details>

<details>
<summary><strong>4. Run the Web App (staff dashboard)</strong></summary>

```bash
cd WebApp
npm install
npm run dev
```

Open **http://localhost:3000** (Vite is set to port **3000** and may open the browser automatically).

</details>

<details>
<summary><strong>5. Run the Mobile App (drivers)</strong></summary>

Use a **second terminal** from the repo root:

```bash
cd MobileApp
npm install
npm start
```

Then:

- Press **`a`** for Android emulator, **`i`** for iOS simulator (macOS), or  
- Scan the **QR code** with **Expo Go** on your phone (same Wi‑Fi as the PC helps).

If the app errors about configuration, ensure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (see section 3).

</details>

<details>
<summary><strong>6. Windows-specific notes</strong></summary>

- Use **PowerShell** or **Command Prompt**; commands above work the same (`cd`, `npm`).
- If the firewall prompts for **Node**, allow access on **private** networks so your phone can reach the Metro/Expo dev server.
- For **Expo Go** on a phone, if the QR URL does not load, try **tunnel** mode: `npx expo start --tunnel` (requires network; first run may be slower).

</details>

<details>
<summary><strong>7. Quick checklist</strong></summary>

| Step | Action |
|------|--------|
| 1 | Install Node.js LTS + Git |
| 2 | Clone repo, `cd Ecoloop` |
| 3 | Add `WebApp/.env` (and/or `MobileApp/.env`) with Supabase URL + anon key |
| 4 | `cd WebApp && npm install && npm run dev` |
| 5 | `cd MobileApp && npm install && npm start` (optional) |
| 6 | New Supabase project: run `database/migrations` + `seed.sql` per `database/README.md` |

</details>
