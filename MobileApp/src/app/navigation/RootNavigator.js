import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import LoginScreen from '../../screens/LoginScreen';
import HelpSupportScreen from '../../screens/HelpSupportScreen';
import LanguageScreen from '../../screens/LanguageScreen';
import NotificationsScreen from '../../screens/NotificationsScreen';
import PrivacySecurityScreen from '../../screens/PrivacySecurityScreen';
import AboutEcoloopScreen from '../../screens/AboutEcoloopScreen';
import TabNavigator from './TabNavigator';
import { fallbackStyles } from '../ErrorBoundary';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { session, profile, driver, signIn, signUp, signOut, loading, authError } = useAuth();
  const loggedIn = Boolean(session && profile && driver);

  if (loading) {
    return (
      <View style={fallbackStyles.container}>
        <Text style={fallbackStyles.title}>Loading account...</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!loggedIn ? (
          <Stack.Screen name="Login">
            {(props) => <LoginScreen {...props} onLogin={signIn} onSignup={signUp} authError={authError} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Main">
              {(props) => <TabNavigator {...props} onLogout={signOut} />}
            </Stack.Screen>
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
            <Stack.Screen name="Language" component={LanguageScreen} />
            <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
            <Stack.Screen name="AboutEcoloop" component={AboutEcoloopScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
