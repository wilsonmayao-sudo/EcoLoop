# EcoLoop - React Native App

A React Native mobile application for waste management route tracking and reporting (EcoLoop).

## Features

- **Home Screen**: Today's route overview, quick actions, and recent activity
- **Navigate Screen**: Route visualization with turn-by-turn directions and pending pickups
- **Map Screen**: Interactive map view with Leaflet/OpenStreetMap integration
- **Reports Screen**: Statistics dashboard, waste generation data, and issue reporting
- **Profile Screen**: User profile management, statistics, and availability settings
- **Settings Screen**: App preferences, theme switching, and notification controls
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

For route API functionality, set the OpenRouteService API key in your environment:
```bash
export OPENROUTE_API_KEY=your_api_key_here
```

Or add it to `app.config.js` for Expo configuration.

## Project Structure

```
PhoneApp/
├── App.js                 # Expo entry point
├── app.json               # Expo configuration
├── app.config.js          # Dynamic Expo config with environment variables
├── babel.config.js        # Babel configuration
├── package.json           # Dependencies and scripts
├── src/
│   ├── app/               # Providers, navigation, and error boundary
│   ├── theme.js           # Color scheme and theme constants (light/dark)
│   ├── screens/           # All screen components
│   │   ├── HomeScreen.js
│   │   ├── MapNavigateScreen.js
│   │   ├── ReportsScreen.js
│   │   ├── ProfileScreen.js
│   │   ├── SettingsScreen.js
│   │   └── LoginScreen.js
│   ├── components/
│   │   └── ui/            # Reusable UI components
│   │       ├── Header.js
│   │       ├── TagChip.js
│   │       ├── StatCard.js
│   │       └── ActionPill.js
│   ├── context/           # React Context providers
│   ├── lib/               # Supabase client
│   └── services/          # Offline sync and service helpers
└── README.md
```

## Technologies Used

- **React Native** (0.81): Mobile app framework
- **Expo** (54): Development platform and tooling
- **React Navigation**: Navigation library (bottom tabs + stack)
- **@expo/vector-icons**: Icon library (Ionicons)
- **React Native Safe Area Context**: Safe area handling
- **React Native WebView**: For map rendering with Leaflet
- **@react-native-async-storage/async-storage**: Local data persistence
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
- Map functionality uses WebView with Leaflet for cross-platform compatibility
- Route API integration requires OpenRouteService API key
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

