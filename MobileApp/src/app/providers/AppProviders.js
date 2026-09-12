import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../../context/ThemeContext';
import { AvatarProvider } from '../../context/AvatarContext';
import { NotificationProvider } from '../../context/NotificationContext';
import { LanguageProvider } from '../../context/LanguageContext';
import { AuthProvider } from '../../context/AuthContext';
import { CompletedRoutesProvider } from '../../context/CompletedRoutesContext';
import { PickupProvider } from '../../context/PickupContext';
import { LiveLocationProvider } from '../../context/LiveLocationContext';

export default function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <PickupProvider>
            <LiveLocationProvider>
              <CompletedRoutesProvider>
                <AvatarProvider>
                  <NotificationProvider>
                    <SafeAreaProvider>{children}</SafeAreaProvider>
                  </NotificationProvider>
                </AvatarProvider>
              </CompletedRoutesProvider>
            </LiveLocationProvider>
          </PickupProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
