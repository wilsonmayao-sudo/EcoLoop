import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import TagChip from "../ui/TagChip";
import AppButton from "../ui/AppButton";
import SurfaceCard from "../ui/SurfaceCard";
import { useTheme } from "../../context/ThemeContext";

/**
 * Expandable list of assigned stops with "mark completed" actions.
 * Used on Home so drivers manage stops without leaving the dashboard.
 */
export default function PendingPickupsList({ pendingPickups, colors, onCompletePickup }) {
  const { tokens } = useTheme();
  const [expandedIndex, setExpandedIndex] = useState(null);

  useEffect(() => {
    if (pendingPickups.length > 0) setExpandedIndex(0);
    else setExpandedIndex(null);
  }, [pendingPickups.length]);

  if (pendingPickups.length === 0) {
    return (
      <SurfaceCard elevated={false}>
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface }]}>
            <Ionicons name="map-outline" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.emptyStateTitle, { color: colors.textPrimary }]}>No assigned stops</Text>
          <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
            When dispatch assigns deliveries in the web dashboard, they appear here and sync automatically.
          </Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <View>
      {pendingPickups.map((pickup, index) => (
        <View key={pickup.deliveryId}>
          {index > 0 && <View style={{ height: tokens.space.md }} />}
          <PendingCard
            binId={pickup.binId}
            deliveryId={pickup.deliveryId}
            isNext={index === 0}
            status={pickup.status}
            due={pickup.due}
            tagColor={colors[pickup.tagColor] || colors.primary}
            hasDelay={pickup.hasDelay}
            expanded={expandedIndex === index}
            onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
            onComplete={() => onCompletePickup(pickup.binId)}
            address={pickup.address}
            street={pickup.street}
            colors={colors}
          />
        </View>
      ))}
    </View>
  );
}

const PendingCard = React.memo(
  ({ isNext, status, due, tagColor, hasDelay, expanded, onToggle, onComplete, address, street, colors }) => {
    const { tokens } = useTheme();
    return (
      <SurfaceCard
        padding={0}
        style={isNext ? { borderWidth: 2, borderColor: colors.mapNext } : undefined}
      >
        <TouchableOpacity onPress={onToggle} activeOpacity={0.75}>
          <View style={styles.pendingCardHeader}>
            <View style={styles.pendingCardContent}>
              <View style={styles.pendingCardTitleRow}>
                <Text style={[styles.pendingCardTitle, { color: colors.textPrimary }]}>{status}</Text>
                {isNext ? (
                  <TagChip label="Next" backgroundColor={colors.chipNextBg} textColor={colors.chipNextText} />
                ) : null}
              </View>
              <View style={styles.pendingCardTags}>
                <TagChip label={due} color={tagColor} />
                {hasDelay ? (
                  <>
                    <View style={{ width: tokens.space.sm }} />
                    <TagChip label="Delays" color={colors.danger} />
                  </>
                ) : null}
              </View>
            </View>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
        {expanded && (
          <View style={styles.expandedContent}>
            <View style={styles.locationInfo}>
              <Text style={[styles.expandedTitle, { color: colors.textPrimary }]}>Location</Text>
              <Text style={[styles.expandedSubtitle, { color: colors.textSecondary }]}>
                <Text style={{ fontWeight: "700" }}>Street:</Text> {street}
              </Text>
              <Text style={[styles.expandedSubtitle, { color: colors.textSecondary }]}>
                <Text style={{ fontWeight: "700" }}>Address:</Text> {address}
              </Text>
            </View>
            <AppButton title="Mark completed" icon="checkmark-circle-outline" onPress={onComplete} />
          </View>
        )}
      </SurfaceCard>
    );
  },
);

const styles = StyleSheet.create({
  pendingCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pendingCardContent: { flex: 1, marginRight: 8 },
  pendingCardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  pendingCardTags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  pendingCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  expandedContent: { paddingHorizontal: 16, paddingBottom: 16 },
  expandedTitle: { fontSize: 14, fontWeight: "800", marginBottom: 6 },
  expandedSubtitle: { fontSize: 14, marginBottom: 6, lineHeight: 20 },
  locationInfo: { marginBottom: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 28, paddingHorizontal: 12 },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateTitle: { fontSize: 17, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  emptyStateSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, fontWeight: "500" },
});
