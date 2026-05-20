import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert, Modal, Dimensions, Image, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/ui/Header';
import TagChip from '../components/ui/TagChip';
import { useTheme } from '../context/ThemeContext';
import * as ImagePicker from 'expo-image-picker';
import { useAvatar } from '../context/AvatarContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import NetInfo from "@react-native-community/netinfo";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";

const screenHeight = Dimensions.get('window').height;

export default function ProfileScreen({ onLogout }) {
  const { colors } = useTheme();
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
      vehicle: driver?.status ? `Status: ${driver.status}` : 'Unassigned',
      status: driver?.status ?? accountProfile?.status ?? 'active',
    });
  }, [accountProfile, driver]);
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title="Profile" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ProfileCard avatarUri={avatarUri} setAvatarUri={setAvatarUri} profile={profile} />
        <View style={styles.spacing} />
        <ProfileInfo profile={profile} setProfile={setProfile} />
        <View style={styles.spacing} />
        <ProfileSettings 
          onChangePassword={() => setShowPassword(true)}
        />
      </ScrollView>
      {showPassword && (
        <PasswordModal
          onClose={() => setShowPassword(false)}
          onSave={async (nextPassword) => {
            const { error } = await supabase.auth.updateUser({ password: nextPassword });
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            setShowPassword(false);
            Alert.alert('Password changed', 'Password updated successfully.');
          }}
        />
      )}
    </SafeAreaView>
  );
}

function ProfileCard({ avatarUri, setAvatarUri, profile }) {
  const { colors } = useTheme();

  const handleChangePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to change avatar.');
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
        <TouchableOpacity onPress={handleChangePhoto} activeOpacity={0.8}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surface }]} />
          )}
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

function ProfileInfo({ profile, setProfile }) {
  const { colors } = useTheme();
  const [expandedField, setExpandedField] = useState(null);
  const [editModal, setEditModal] = useState(null);

  const fields = [
    {
      key: 'role',
      title: 'Role',
      value: profile.role,
      editable: false,
      icon: 'person-outline',
    },
    {
      key: 'email',
      title: 'Email',
      value: profile.email,
      editable: true,
      icon: 'mail-outline',
    },
    {
      key: 'phone',
      title: 'Phone',
      value: profile.phone,
      editable: true,
      icon: 'call-outline',
    },
    {
      key: 'address',
      title: 'Address',
      value: profile.address,
      editable: true,
      icon: 'home-outline',
    },
    {
      key: 'vehicle',
      title: 'Vehicle',
      value: profile.vehicle,
      editable: false,
      icon: 'bus-outline',
    },
  ];

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Profile Information</Text>
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

function ProfileSettings({ onChangePassword }) {
  const { colors } = useTheme();
  const { driver } = useAuth();
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
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Settings</Text>
      <SwitchTile
        title="Availability"
        subtitle={isAvailable ? 'Available for routes' : 'Not available'}
        value={isAvailable}
        onValueChange={onToggleAvailability}
        colors={colors}
      />
      <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
      <NavTile
        title="Change Password"
        subtitle="Update your password"
        onPress={onChangePassword}
        colors={colors}
      />
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
  const maxDropdownHeight = screenHeight * 0.5;

  return (
    <View>
      <TouchableOpacity style={styles.listItem} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.listItemLeft}>
          <Ionicons name={icon} size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
          <View style={styles.listItemContent}>
            <Text style={[styles.listItemTitle, { color: colors.textPrimary }]}>{title}</Text>
            <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>{value}</Text>
          </View>
        </View>
        <Ionicons 
          name={expanded ? 'chevron-up' : 'chevron-down'} 
          size={20} 
          color={colors.textSecondary} 
        />
      </TouchableOpacity>
      {expanded && (
        <Modal
          transparent
          visible={expanded}
          animationType="fade"
          onRequestClose={onToggle}
        >
          <TouchableOpacity
            style={styles.dropdownOverlay}
            activeOpacity={1}
            onPress={onToggle}
          >
            <View
              style={[
                styles.dropdownList,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.textSecondary + '33',
                  maxHeight: maxDropdownHeight,
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <ScrollView
                style={styles.dropdownScrollView}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                {options.map((option, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.dropdownItem,
                      {
                        backgroundColor: value === option ? colors.primary + '15' : 'transparent',
                        borderBottomColor: colors.textSecondary + '1A',
                      },
                    ]}
                    onPress={() => {
                      onSelect(option);
                      onToggle();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        {
                          color: value === option ? colors.primary : colors.textPrimary,
                          fontWeight: value === option ? '700' : '500',
                        },
                      ]}
                    >
                      {option}
                    </Text>
                    {value === option && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
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
    <TouchableOpacity style={styles.listItem} onPress={onPress} activeOpacity={0.7}>
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
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{field.title}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
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

function PasswordModal({ onClose, onSave }) {
  const { colors } = useTheme();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSave = () => {
    if (!next || next.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (next !== confirm) {
      Alert.alert('Error', 'New password and confirmation do not match.');
      return;
    }
    onSave(next);
  };

  return (
    <Modal transparent visible={true} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { backgroundColor: colors.textPrimary + 'CC' }]}>
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Change Password</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>New Password</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
              value={next}
              onChangeText={setNext}
              placeholder="New password"
              placeholderTextColor={colors.textSecondary + '66'}
              secureTextEntry
            />

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Confirm Password</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirm password"
              placeholderTextColor={colors.textSecondary + '66'}
              secureTextEntry
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
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
  dropdownList: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownScrollView: {
    maxHeight: screenHeight * 0.5,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  dropdownItemText: {
    fontSize: 15,
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
    borderRadius: 10,
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
});
