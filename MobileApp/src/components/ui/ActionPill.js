import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

export default function ActionPill({ label, icon, color, onPress }) {
  const { colors } = useTheme();
  const pillColor = color || colors.primary;
  
  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: pillColor + '1A', borderColor: pillColor + '33' }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={pillColor} />
      <Text style={[styles.label, { color: pillColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  label: {
    fontWeight: '600',
    fontSize: 14,
  },
});

