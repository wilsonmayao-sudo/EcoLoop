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
        style={isNext ? { borderWidth: 1.5, borderColor: colors.mapNext + "99" } : undefined}
      >
        <TouchableOpacity onPress={onToggle} activeOpacity={0.82}>
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
            <View style={[styles.chevronWrap, { backgroundColor: colors.surface }]}>
              <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
            </View>
          </View>
        </TouchableOpacity>
        {expanded && (
          <View style={styles.expandedContent}>
            <View style={[styles.expandedDivider, { backgroundColor: colors.borderSubtle }]} />
            <View style={[styles.locationInfo, { backgroundColor: colors.surface }]}>
              <Text style={[styles.expandedTitle, { color: colors.textPrimary }]}>Location</Text>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Street</Text>
                <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{street}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Address</Text>
                <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{address}</Text>
              </View>
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
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  pendingCardContent: { flex: 1, marginRight: 12 },
  pendingCardTitle: { fontSize: 17, fontWeight: "800", marginBottom: 10, lineHeight: 22, letterSpacing: -0.2 },
  pendingCardTags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  pendingCardTitleRow: { gap: 10 },
  chevronWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  expandedContent: { paddingHorizontal: 18, paddingBottom: 18 },
  expandedDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  expandedTitle: { fontSize: 14, fontWeight: "800", marginBottom: 10 },
  detailRow: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  detailValue: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  locationInfo: { marginBottom: 14, borderRadius: 14, padding: 14 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 30, paddingHorizontal: 16 },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateTitle: { fontSize: 17, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  emptyStateSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 21, fontWeight: "500" },
});
