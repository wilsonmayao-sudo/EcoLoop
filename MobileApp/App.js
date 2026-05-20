import 'react-native-gesture-handler';
import React from 'react';
import ErrorBoundary from './src/app/ErrorBoundary';
import AppProviders from './src/app/providers/AppProviders';
import RootNavigator from './src/app/navigation/RootNavigator';

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </ErrorBoundary>
  );
}

