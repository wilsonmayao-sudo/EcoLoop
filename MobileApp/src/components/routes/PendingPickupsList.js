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
export default function PendingPickupsList({ pendingPickups, colors, onCompletePickup, canComplete = true }) {
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

  const nextOpenIndex = pendingPickups.findIndex((pickup) => pickup.deliveryStatus !== "completed");

  return (
    <View>
      {pendingPickups.map((pickup, index) => (
        <View key={pickup.deliveryId}>
          {index > 0 && <View style={{ height: tokens.space.md }} />}
          <PendingCard
            binId={pickup.binId}
            deliveryId={pickup.deliveryId}
            isNext={index === nextOpenIndex}
            status={pickup.status}
            deliveryStatus={pickup.deliveryStatus}
            due={pickup.due}
            tagColor={colors[pickup.tagColor] || colors.primary}
            hasDelay={pickup.hasDelay}
            expanded={expandedIndex === index}
            onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
            onComplete={() => onCompletePickup(pickup.deliveryId, pickup.binId)}
            canComplete={canComplete}
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
  ({ isNext, status, deliveryStatus, due, tagColor, hasDelay, expanded, onToggle, onComplete, canComplete, address, street, colors }) => {
    const isCompleted = deliveryStatus === "completed";
    return (
      <SurfaceCard
        padding={0}
        style={isNext && !isCompleted ? { borderWidth: 1.5, borderColor: colors.mapNext + "99" } : undefined}
      >
        <TouchableOpacity onPress={onToggle} activeOpacity={0.82}>
          <View style={styles.pendingCardHeader}>
            <View style={styles.pendingCardContent}>
              <View style={styles.pendingCardTitleRow}>
                <Text style={[styles.pendingCardTitle, { color: colors.textPrimary }]} numberOfLines={3}>
                  {status}
                </Text>
              </View>
              <View style={styles.pendingCardTags}>
                {isCompleted ? (
                  <TagChip label="Completed" color={colors.success} />
                ) : isNext ? (
                  <TagChip label="Next" backgroundColor={colors.chipNextBg} textColor={colors.chipNextText} />
                ) : null}
                <TagChip label={due} color={tagColor} />
                {hasDelay ? (
                  <>
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
            {isCompleted ? (
              <View style={[styles.completedPill, { backgroundColor: colors.success + "18" }]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.completedPillText, { color: colors.success }]}>Completed</Text>
              </View>
            ) : (
              <AppButton
                title={canComplete ? "Complete" : "Accept route assignment"}
                icon="checkmark-circle-outline"
                onPress={onComplete}
                disabled={!canComplete}
              />
            )}
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
  pendingCardContent: { flex: 1, minWidth: 0, marginRight: 12 },
  pendingCardTitle: { flexShrink: 1, fontSize: 17, fontWeight: "800", lineHeight: 22 },
  pendingCardTags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  pendingCardTitleRow: { marginBottom: 10, minWidth: 0 },
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
  completedPill: {
    minHeight: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  completedPillText: { fontSize: 15, fontWeight: "800" },
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
