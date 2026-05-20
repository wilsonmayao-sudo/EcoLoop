import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../../context/ThemeContext";
import { TAB_BAR_CONTENT_HEIGHT } from "../../constants/layout";
import HomeScreen from "../../screens/HomeScreen";
import MapNavigateScreen from "../../screens/MapNavigateScreen";
import ReportsScreen from "../../screens/ReportsScreen";
import ProfileScreen from "../../screens/ProfileScreen";
import SettingsScreen from "../../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

const TabBarIcon = React.memo(({ route, focused, color, size }) => {
  let iconName;

  if (route.name === "Home") {
    iconName = focused ? "home" : "home-outline";
  } else if (route.name === "Map") {
    iconName = focused ? "map" : "map-outline";
  } else if (route.name === "Reports") {
    iconName = focused ? "bar-chart" : "bar-chart-outline";
  } else if (route.name === "Profile") {
    iconName = focused ? "person" : "person-outline";
  } else if (route.name === "Settings") {
    iconName = focused ? "settings" : "settings-outline";
  }

  return <Ionicons name={iconName} size={focused ? 24 : 23} color={color} />;
});

export default function TabNavigator({ onLogout }) {
  const { colors, tokens, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();

  const tabBarBottomPad = Math.max(insets.bottom, Platform.OS === "ios" ? 10 : 8);
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + tabBarBottomPad;

  return (
    <>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => (
            <TabBarIcon route={route} focused={focused} color={color} size={size} />
          ),
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          headerShown: false,
          tabBarStyle: [
            styles.tabBar,
            {
              height: tabBarHeight,
              paddingBottom: tabBarBottomPad,
              paddingTop: tokens.space.sm,
              backgroundColor: colors.card,
              borderTopColor: colors.borderSubtle,
            },
          ],
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.2,
            marginTop: 2,
          },
          tabBarItemStyle: {
            paddingTop: 2,
          },
          lazy: true,
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Map" component={MapNavigateScreen} options={{ tabBarLabel: "Navigate" }} />
        <Tab.Screen name="Reports" component={ReportsScreen} />
        <Tab.Screen name="Profile">
          {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
        </Tab.Screen>
        <Tab.Screen name="Settings">
          {(props) => <SettingsScreen {...props} onLogout={onLogout} />}
        </Tab.Screen>
      </Tab.Navigator>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
});
