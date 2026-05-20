import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

export default function StatCard({ label, value, sub, icon, color }) {
  const { colors } = useTheme();
  const cardColor = color || colors.primary;
  
  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.textSecondary + '14' }]}>
      {icon && (
        <View style={[styles.iconContainer, { backgroundColor: cardColor + '1F' }]}>
          <Ionicons name={icon} size={20} color={cardColor} />
        </View>
      )}
      {icon && <View style={styles.spacing} />}
      <View style={styles.content}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
        {sub && <Text style={[styles.sub, { color: colors.textSecondary }]}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minHeight: 96,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacing: {
    width: 10,
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
  },
});

