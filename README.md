# Ecoloop

## Project Title and Description
**Ecoloop** is a waste management system for SWMO Naga that connects truck drivers through a mobile app and staff through a web system. It features report and issues, vehicle monitoring, route optimization, and bin location tracking. Drivers follow routes and report problems, while staff monitor vehicles, assign routes, manage operations efficiently.

## Tech Stack
- **Languages:** TypeScript, JavaScript, HTML, CSS, JSON, Markdown
- **Web Frontend:** React, Vite, Tailwind CSS, Mapbox GL JS
- **Mobile App:** React Native, Expo, Mapbox GL JS (WebView)
- **Core Libraries:** React Navigation, AsyncStorage
- **Backend/Services:** Supabase Auth, Postgres, Realtime, and Row Level Security
- **Package Manager:** npm

## Installation Guide
### Prerequisites
1. Install **Node.js** (18 LTS or higher recommended).
2. Install **npm** (included with Node.js).
3. For mobile development, install **Expo Go** on your phone or Android/iOS emulator tooling.

### Clone the Repository
```bash
git clone https://github.com/wilsonmayao-sudo/EcoLoop
cd Ecoloop
```

### Environment Configuration
Copy each template file and provide your own Supabase and Mapbox credentials (never commit `.env` files):
- Web app: copy [`WebApp/.env.example`](WebApp/.env.example) to `WebApp/.env`
- Mobile app: copy [`MobileApp/.env.example`](MobileApp/.env.example) to `MobileApp/.env` (use a Mapbox `pk.*` token without web URL referrer restrictions so mobile WebView tiles load)

### Run & Build the Web App
```bash
cd WebApp
npm install
npm run dev
npm run build
```

### Run the Mobile App
Open a new terminal:
```bash
cd MobileApp
npm install
npx expo start --clear
```

Then press:
- `a` for Android emulator
- `i` for iOS simulator
- or scan the QR code using Expo Go

### Verification Scripts
Run automated regression and verification checks from the repository root:
```bash
node scripts/verify-map-loading.mjs
node scripts/verify-dispatcher-fleet-permissions.mjs
node scripts/verify-dispatch-assignment-sync.mjs
node scripts/verify-overflow-mobile-sync.mjs
node scripts/verify-dynamic-reassignment.mjs
node scripts/verify-fixes.mjs
```

## Branching Strategy
- `main` -> production-ready branch (protected; no direct pushes)
- `develop` -> integration branch for completed features
- `feature/<feature-name>` -> feature development branches

### Workflow
1. Branch from `develop`: `feature/user-authentication`
2. Commit feature changes in the feature branch.
3. Open a Pull Request from `feature/...` to `develop`.
4. Review, approve, and merge PR.
5. Periodically create PRs from `develop` to `main`.

### Example Feature Branch Used
- `feature/repository-guidelines` -> adds repository compliance documentation updates.

## Contributors

- **Member 1** - Nathaniel Jr. S. Alcantara
- **Member 2** - Wilson Dl Mayao Jr.
- **Member 3** - Marc Benjamin Yu Chang
- **Member 4** - Joseph Benedict Sadueste
