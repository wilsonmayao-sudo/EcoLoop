import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert, Modal, Image, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Header from '../components/ui/Header';
import TagChip from '../components/ui/TagChip';
import AppDropdown from '../components/ui/AppDropdown';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { useLanguage } from '../context/LanguageContext';
import * as ImagePicker from 'expo-image-picker';
import { useAvatar } from '../context/AvatarContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import NetInfo from "@react-native-community/netinfo";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";

export default function ProfileScreen({ onLogout }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const [showPassword, setShowPassword] = useState(false);
  const { avatarUri, setAvatarUri } = useAvatar();
  const { profile: accountProfile, driver } = useAuth();

  const [profile, setProfile] = useState({
    name: '',
    id: '',
    role: 'Truck Driver',
    email: '',
    phone: '',
    address: '',
    vehicle: '',
    status: 'active',
  });

  useEffect(() => {
    setProfile({
      name: accountProfile?.full_name ?? driver?.name ?? 'Truck Driver',
      id: driver?.id ? `Driver ID: ${driver.id}` : 'Driver ID: Pending',
      role: 'Truck Driver',
      email: accountProfile?.email ?? '',
      phone: accountProfile?.phone_number ?? driver?.phone_number ?? 'Not provided',
      address: accountProfile?.address ?? driver?.address ?? 'Not provided',
      vehicle: driver?.status
        ? `Status: ${String(driver.status).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`
        : 'Unassigned',
      status: driver?.status ?? accountProfile?.status ?? 'active',
    });
  }, [accountProfile, driver]);
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t('profile_title', 'Profile')} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ProfileCard avatarUri={avatarUri} setAvatarUri={setAvatarUri} profile={profile} t={t} />
        <View style={styles.spacing} />
        <ProfileInfo profile={profile} setProfile={setProfile} t={t} />
        <View style={styles.spacing} />
        <ProfileSettings 
          onChangePassword={() => setShowPassword(true)}
          onLogout={onLogout}
          t={t}
        />
      </ScrollView>
      {showPassword && (
        <PasswordModal
          onClose={() => setShowPassword(false)}
          t={t}
          onSave={async (nextPassword) => {
            const { error } = await supabase.auth.updateUser({ password: nextPassword });
            if (error) {
              Alert.alert(t('error_title', 'Error'), error.message);
              return;
            }
            setShowPassword(false);
            Alert.alert(t('pw_changed_title', 'Password Changed'), t('pw_changed_msg', 'Password updated successfully.'));
          }}
        />
      )}
    </SafeAreaView>
  );
}

function ProfileCard({ avatarUri, setAvatarUri, profile, t }) {
  const { colors } = useTheme();

  const handleChangePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('alert_perm_req', 'Permission Required'),
        t('perm_avatar_msg', 'Allow photo library access to change avatar.'),
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.profileRow}>
        <TouchableOpacity
          onPress={handleChangePhoto}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          style={styles.avatarWrap}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
              <Ionicons name="person" size={24} color={colors.primary} />
            </View>
          )}
          <View style={[styles.avatarBadge, { backgroundColor: colors.primary, borderColor: colors.card }]}>
            <Ionicons name="camera" size={11} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.textPrimary }]}>{profile.name}</Text>
          <Text style={[styles.profileId, { color: colors.textSecondary }]}>{profile.id}</Text>
          <View style={styles.tagContainer}>
            <TagChip label={profile.status === 'active' ? 'Active' : profile.status} color={colors.success} />
          </View>
        </View>
      </View>
    </View>
  );
}

function ProfileInfo({ profile, setProfile, t }) {
  const { colors } = useTheme();
  const [expandedField, setExpandedField] = useState(null);
  const [editModal, setEditModal] = useState(null);

  const fields = [
    {
      key: 'role',
      title: t ? t('role_label', 'Role') : 'Role',
      value: profile.role,
      editable: false,
      icon: 'person-outline',
    },
    {
      key: 'email',
      title: t ? t('email_label', 'Email') : 'Email',
      value: profile.email,
      editable: true,
      icon: 'mail-outline',
    },
    {
      key: 'phone',
      title: t ? t('phone_label', 'Phone') : 'Phone',
      value: profile.phone,
      editable: true,
      icon: 'call-outline',
    },
    {
      key: 'address',
      title: t ? t('address_label', 'Address') : 'Address',
      value: profile.address,
      editable: true,
      icon: 'home-outline',
    },
    {
      key: 'vehicle',
      title: t ? t('vehicle_label', 'Vehicle') : 'Vehicle',
      value: profile.vehicle,
      editable: false,
      icon: 'bus-outline',
    },
  ];

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          {t ? t('profile_information', 'Profile Information') : 'Profile Information'}
        </Text>
        {fields.map((field, index) => (
          <View key={field.key}>
            {index > 0 && <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />}
            {field.options ? (
              <DropdownTile
                title={field.title}
                value={field.value}
                options={field.options}
                icon={field.icon}
                onSelect={(value) => setProfile({ ...profile, [field.key]: value })}
                expanded={expandedField === field.key}
                onToggle={() => setExpandedField(expandedField === field.key ? null : field.key)}
                colors={colors}
              />
            ) : (
              <InfoTile
                title={field.title}
                value={field.value}
                icon={field.icon}
                editable={field.editable}
                onPress={() => {
                  if (field.editable) {
                    setEditModal({ key: field.key, title: field.title, value: field.value });
                  }
                }}
                colors={colors}
              />
            )}
          </View>
        ))}
      </View>
      {editModal && (
        <EditFieldModal
          field={editModal}
          onClose={() => setEditModal(null)}
          onSave={(value) => {
            setProfile({ ...profile, [editModal.key]: value });
            setEditModal(null);
          }}
          colors={colors}
        />
      )}
    </>
  );
}

function ProfileSettings({ onChangePassword, onLogout, t }) {
  const { colors, isDarkMode, toggleTheme } = useTheme();
  const { enabled: notificationsEnabled, toggle: toggleNotifications } = useNotifications();
  const { language } = useLanguage();
  const navigation = useNavigation();
  const { driver, setDriverStatus } = useAuth();
  const [isAvailable, setIsAvailable] = useState(true);

  const executeQueuedMutation = async (mutation) => {
    if (mutation.type === "SET_DRIVER_STATUS") {
      const { error } = await supabase.from("drivers").update({ status: mutation.status }).eq("id", mutation.driverId);
      if (error) throw error;
    }
  };

  useEffect(() => {
    const current = String(driver?.status ?? "").toLowerCase();
    if (!current) return;
    setIsAvailable(current !== "inactive" && current !== "suspended");
  }, [driver?.status]);

  useEffect(() => {
    let cleanup = () => {};
    const boot = async () => {
      await flushOfflineQueue(executeQueuedMutation);
      cleanup = subscribeConnectivity(executeQueuedMutation);
    };
    boot();
    return () => cleanup();
  }, []);

  const onToggleAvailability = async (next) => {
    setIsAvailable(next);
    if (!driver?.id) return;
    const nextStatus = next ? "available" : "inactive";
    setDriverStatus(nextStatus);
    const state = await NetInfo.fetch();
    if (!state.isConnected) {
      await enqueueMutation({ type: "SET_DRIVER_STATUS", driverId: driver.id, status: nextStatus });
      return;
    }
    try {
      await executeQueuedMutation({ type: "SET_DRIVER_STATUS", driverId: driver.id, status: nextStatus });
    } catch (e) {
      await enqueueMutation({ type: "SET_DRIVER_STATUS", driverId: driver.id, status: nextStatus });
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t ? t('settings_title', 'Settings') : 'Settings'}</Text>
      <SwitchTile
        title={t ? t('availability_title', 'Availability') : 'Availability'}
        subtitle={isAvailable ? (t ? t('available_for_routes', 'Available for routes') : 'Available for routes') : (t ? t('not_available', 'Not available') : 'Not available')}
        value={isAvailable}
        onValueChange={onToggleAvailability}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title={t ? t('change_password', 'Change Password') : 'Change Password'}
        subtitle={t ? t('update_your_password', 'Update your password') : 'Update your password'}
        onPress={onChangePassword}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <SwitchTile
        title={t ? t('notifications_title', 'Notifications') : 'Notifications'}
        subtitle={t ? t('notifications_sub', 'Route alerts & updates') : 'Route alerts & updates'}
        value={notificationsEnabled}
        onValueChange={toggleNotifications}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <SwitchTile
        title={t ? t('dark_mode_title', 'Dark Mode') : 'Dark Mode'}
        subtitle={t ? t('dark_mode_sub', 'Switch to dark theme') : 'Switch to dark theme'}
        value={isDarkMode}
        onValueChange={toggleTheme}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title={t ? t('language_title', 'Language') : 'Language'}
        subtitle={language === 'en' ? 'English' : 'Tagalog (Filipino)'}
        onPress={() => navigation.navigate('Language')}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title={t ? t('privacy_security_title', 'Privacy & Security') : 'Privacy & Security'}
        subtitle={t ? t('privacy_security_sub', 'Data protection settings') : 'Data protection settings'}
        onPress={() => navigation.navigate('PrivacySecurity')}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title={t ? t('help_support_title', 'Help & Support') : 'Help & Support'}
        subtitle={t ? t('help_support_sub', 'FAQ and contact') : 'FAQ and contact'}
        onPress={() => navigation.navigate('HelpSupport')}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title={t ? t('about_ecoloop_title', 'About EcoLoop') : 'About EcoLoop'}
        subtitle="Version 1.0.0"
        onPress={() => navigation.navigate('AboutEcoloop')}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => {
          Alert.alert(
            t ? t('log_out', 'Log Out') : 'Log Out',
            t ? t('log_out_confirm', 'Are you sure you want to log out?') : 'Are you sure you want to log out?',
            [
              { text: t ? t('cancel', 'Cancel') : 'Cancel', style: 'cancel' },
              {
                text: t ? t('log_out', 'Log Out') : 'Log Out',
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
        accessibilityRole="button"
        accessibilityLabel={t ? t('log_out', 'Log Out') : 'Log Out'}
      >
        <View style={styles.listItemContent}>
          <Text style={[styles.listItemTitle, { color: colors.danger }]}>{t ? t('log_out', 'Log Out') : 'Log Out'}</Text>
          <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{t ? t('log_out_sub', 'Sign out of your account') : 'Sign out of your account'}</Text>
        </View>
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

function InfoTile({ title, value, icon, editable, onPress, colors }) {
  return (
    <TouchableOpacity 
      style={styles.listItem} 
      onPress={onPress}
      activeOpacity={editable ? 0.7 : 1}
      disabled={!editable}
    >
      <View style={styles.listItemLeft}>
        <Ionicons name={icon} size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
        <View style={styles.listItemContent}>
          <Text style={[styles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{value}</Text>
        </View>
      </View>
      {editable && <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
    </TouchableOpacity>
  );
}

function DropdownTile({ title, value, options, icon, onSelect, expanded, onToggle, colors }) {
  return (
    <AppDropdown
      label={title}
      value={value}
      options={options}
      onSelect={onSelect}
      expanded={expanded}
      onToggle={onToggle}
      renderTrigger={({ open, onPress }) => (
        <TouchableOpacity style={styles.listItem} onPress={onPress} activeOpacity={0.7}>
          <View style={styles.listItemLeft}>
            <Ionicons name={icon} size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
            <View style={styles.listItemContent}>
              <Text style={[styles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
              <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{value}</Text>
            </View>
          </View>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      )}
    />
  );
}

function SwitchTile({ title, subtitle, value, onValueChange, colors }) {
  return (
    <View style={styles.listItem}>
      <View style={styles.listItemContent}>
        <Text style={[styles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
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

function NavTile({ title, subtitle, onPress, colors }) {
  return (
    <TouchableOpacity
      style={styles.listItem}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.listItemContent}>
        <Text style={[styles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function EditFieldModal({ field, onClose, onSave, colors }) {
  const [value, setValue] = useState(field.value);

  const handleSave = () => {
    if (value.trim()) {
      onSave(value.trim());
    }
  };

  return (
    <Modal transparent visible={true} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { backgroundColor: colors.textPrimary + 'CC' }]}>
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Edit {field.title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Close edit dialog"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{field.title}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
              value={value}
              onChangeText={setValue}
              placeholder={`Enter ${field.title.toLowerCase()}`}
              placeholderTextColor={colors.textSecondary + '66'}
              autoFocus
              keyboardType={field.key === 'email' ? 'email-address' : field.key === 'phone' ? 'phone-pad' : 'default'}
            />
          </View>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.surface }]} onPress={onClose}>
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PasswordModal({ onClose, onSave, t }) {
  const { colors } = useTheme();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSave = () => {
    if (!next || next.length < 6) {
      Alert.alert(t('error_title', 'Error'), t('pw_len_err', 'New password must be at least 6 characters.'));
      return;
    }
    if (next !== confirm) {
      Alert.alert(t('error_title', 'Error'), t('pw_mismatch_err', 'New password and confirmation do not match.'));
      return;
    }
    onSave(next);
  };

  return (
    <Modal transparent visible={true} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { backgroundColor: colors.textPrimary + 'CC' }]}>
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t('change_password', 'Change Password')}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Close password dialog"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{t('new_pw_label', 'New Password')}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
              value={next}
              onChangeText={setNext}
              placeholder={t('new_pw_ph', 'New password')}
              placeholderTextColor={colors.textSecondary + '66'}
              secureTextEntry
            />

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{t('confirm_pw_label', 'Confirm Password')}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t('confirm_pw_ph', 'Confirm password')}
              placeholderTextColor={colors.textSecondary + '66'}
              secureTextEntry
            />
          </View>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.surface }]} onPress={onClose}>
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>{t('cancel', 'Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>{t('save', 'Save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
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
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  profileId: {
    fontSize: 12,
    marginBottom: 4,
  },
  tagContainer: {
    alignSelf: 'flex-start',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: 12,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  listItemSubtitle: {
    fontSize: 14,
  },
  divider: {
    height: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    gap: 10,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalButton: {
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
