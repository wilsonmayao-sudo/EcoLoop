import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/ui/Header';
import { useNavigation } from '@react-navigation/native';
import TagChip from '../components/ui/TagChip';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { useAvatar } from '../context/AvatarContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

export default function SettingsScreen({ onLogout }) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title="Settings" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ProfileCard />
        <View style={styles.spacing} />
        <Preferences onLogout={onLogout} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileCard() {
  const { colors } = useTheme();
  const dynamicStyles = getDynamicStyles(colors);
  const { avatarUri } = useAvatar();
  const { profile, driver } = useAuth();
  const displayName = profile?.full_name ?? driver?.name ?? 'Truck Driver';
  const displayId = driver?.id ? `Driver ID: ${driver.id}` : 'Driver ID: Pending';
  const displayStatus = driver?.status ?? profile?.status ?? 'active';

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.profileRow}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.surface }]} />
        )}
        <View style={styles.profileInfo}>
          <Text style={[dynamicStyles.profileName, { color: colors.textPrimary }]}>{displayName}</Text>
          <Text style={[dynamicStyles.profileId, { color: colors.textSecondary }]}>{displayId}</Text>
          <View style={styles.tagContainer}>
            <TagChip label={displayStatus === 'active' ? 'Active' : displayStatus} color={colors.success} />
          </View>
        </View>
      </View>
    </View>
  );
}

function Preferences({ onLogout }) {
  const { colors, isDarkMode, toggleTheme } = useTheme();
  const { enabled: notificationsEnabled, toggle: toggleNotifications } = useNotifications();
  const { language } = useLanguage();
  const navigation = useNavigation();
  const dynamicStyles = getDynamicStyles(colors);

  const getLanguageDisplay = () => {
    return language === 'en' ? 'English' : 'Tagalog (Filipino)';
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <SwitchTile
        title="Notifications"
        subtitle="Route alerts & updates"
        value={notificationsEnabled}
        onValueChange={toggleNotifications}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <SwitchTile
        title="Dark Mode"
        subtitle="Switch to dark theme"
        value={isDarkMode}
        onValueChange={toggleTheme}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title="Language"
        subtitle={getLanguageDisplay()}
        onPress={() => navigation.navigate('Language')}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title="Privacy & Security"
        subtitle="Data protection settings"
        onPress={() => navigation.navigate('PrivacySecurity')}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title="Help & Support"
        subtitle="FAQ and contact"
        onPress={() => navigation.navigate('HelpSupport')}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title="About EcoLoop"
        subtitle="Version 1.2.0"
        onPress={() => navigation.navigate('AboutEcoloop')}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => {
          Alert.alert(
            'Log Out',
            'Are you sure you want to log out?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Log Out',
                style: 'destructive',
                onPress: () => {
                  if (onLogout) onLogout();
                },
              },
            ],
            { cancelable: true }
          );
        }}
        activeOpacity={0.7}
      >
        <View style={styles.listItemContent}>
          <Text style={[dynamicStyles.listItemTitle, { color: '#EF4444' }]}>Log Out</Text>
          <Text style={[dynamicStyles.listItemSubtitle, { color: colors.textSecondary }]}>Sign out of your account</Text>
        </View>
        <Ionicons name="log-out-outline" size={20} color="#EF4444" />
      </TouchableOpacity>
    </View>
  );
}

function SwitchTile({ title, subtitle, value, onValueChange }) {
  const { colors } = useTheme();
  const dynamicStyles = getDynamicStyles(colors);

  return (
    <View style={styles.listItem}>
      <View style={styles.listItemContent}>
        <Text style={[dynamicStyles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[dynamicStyles.listItemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.textSecondary + '40', true: colors.primary + '80' }}
        thumbColor={value ? colors.primary : colors.textSecondary}
      />
    </View>
  );
}

function NavTile({ title, subtitle, onPress }) {
  const { colors } = useTheme();
  const dynamicStyles = getDynamicStyles(colors);

  return (
    <TouchableOpacity style={styles.listItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.listItemContent}>
        <Text style={[dynamicStyles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[dynamicStyles.listItemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function getDynamicStyles(colors) {
  return StyleSheet.create({
    profileName: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 2,
    },
    profileId: {
      fontSize: 12,
      marginBottom: 4,
    },
    listItemTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 2,
    },
    listItemSubtitle: {
      fontSize: 14,
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  spacing: {
    height: 12,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  profileInfo: {
    flex: 1,
  },
  tagContainer: {
    alignSelf: 'flex-start',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  listItemContent: {
    flex: 1,
  },
  divider: {
    height: 1,
  },
});

