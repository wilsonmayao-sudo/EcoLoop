# EcoLoop - React Native App

A React Native mobile application for waste management route tracking and reporting (EcoLoop).

## Features

- **Home Screen**: Today's route overview, driver-reported load/overflow controls, and pending pickups
- **Map & Navigate Screen**: Turn-by-turn navigation, street geometry, and SWMO landfill guidance
- **Reports Screen**: Waste collection history and issue reporting
- **Notifications Screen**: Route assignment and overflow notifications
- **Profile, Language, Privacy & Help Screens**: Driver account details, preferences, and support information
- **Login Screen**: Authentication interface for drivers

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Expo CLI (`npm install -g expo-cli` or use `npx expo`)
- iOS Simulator (for iOS) or Android Emulator (for Android)
- Expo Go app (for physical device testing)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

3. Run on your preferred platform:
- Press `i` for iOS simulator
- Press `a` for Android emulator
- Scan QR code with Expo Go app on your physical device

### Environment Setup

Copy [`.env.example`](.env.example) to `.env` and fill in your client configuration:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

## Project Structure

```
MobileApp/
├── App.js                 # Expo entry point
├── app.json               # Expo static configuration
├── app.config.js          # Dynamic Expo config reading environment variables
├── package.json           # Dependencies and scripts
├── src/
│   ├── app/               # Providers, navigation, and error boundary
│   ├── theme.js           # Color scheme and theme constants (light/dark)
│   ├── screens/           # Home, MapNavigate, Reports, Notifications, Profile, Login, and info screens
│   ├── components/
│   │   └── ui/            # Reusable UI components (AppButton, AppDropdown, Header, SurfaceCard, TagChip)
│   ├── context/           # React Context providers (Auth, Pickup, Notifications, Settings, Theme)
│   ├── lib/               # Supabase client
│   ├── services/          # Live location, local notifications, and offline sync
│   └── utils/             # Route geometry, geo navigation, Mapbox WebView, and schema fallback helpers
└── README.md
```

## Technologies Used

- **React Native** (0.88): Mobile app framework
- **Expo** (SDK 58): Development platform and tooling
- **React Navigation**: Navigation library (bottom tabs + stack)
- **@expo/vector-icons**: Icon library (Ionicons)
- **React Native Safe Area Context**: Safe area handling
- **React Native WebView**: Interactive map rendering with Mapbox / Leaflet
- **@react-native-async-storage/async-storage**: Local data persistence
- **expo-location**: Foreground/background route GPS telemetry
- **expo-notifications**: Dev/production local route notifications (guarded in Expo Go)
- **expo-image-picker**: Image selection for profile and reports
- **expo-constants**: Access to app configuration

## Key Features

### Navigation
- Bottom tab navigation for main screens
- Stack navigation for login/main app flow
- Deep linking support for route parameters

### State Management
- React Context for theme, avatar, and notifications
- AsyncStorage for persistent preferences
- Local state management for forms and UI

### Performance Optimizations
- React.memo for component memoization
- Lazy loading for tab screens
- Optimized re-renders with proper dependency arrays

### Theme Support
- Light and dark mode support
- Persistent theme preferences
- Dynamic color scheme switching

## Configuration

### App Configuration
- App name: EcoLoop
- Bundle ID: com.ecoloop.app
- Version: 1.0.0

### Permissions
- Location access (for maps and route tracking)
- Camera/Photo library (for report photos and profile pictures)

## Development Notes

- The app uses Supabase Auth and live database tables for driver accounts and assigned pickups
- Map functionality uses WebView with Mapbox GL JS / Leaflet for cross-platform compatibility
- Street routing uses Mapbox Directions API with keyless public OSRM and cached polyline fallbacks
- AsyncStorage is used for preferences, avatar cache, and offline mutation queue
- Error boundaries are implemented for graceful error handling

## Code Quality

- Clean, maintainable code structure
- Consistent naming conventions
- Proper error handling
- No console.log statements in production code
- Optimized imports and dependencies

## Version

1.0.0

## License

Private project

