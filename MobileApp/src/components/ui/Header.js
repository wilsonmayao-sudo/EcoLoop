import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";

export default function Header({ title, subtitle = "City of Naga", onBack, rightIcons, rightButton }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.headerBg }]}>
      <View style={styles.leftRow}>
        {typeof onBack === "function" && (
          <TouchableOpacity
            style={styles.backTouch}
            onPress={onBack}
            activeOpacity={0.76}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <View style={styles.leftSection}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {Boolean(subtitle) && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      {rightIcons && (
        <View style={styles.rightIcons}>
          {rightIcons.map((iconItem, index) => {
            const item = typeof iconItem === "string" ? { name: iconItem } : iconItem;
            const { name, onPress, active, badge, accessibilityLabel } = item;
            return (
              <TouchableOpacity
                key={`${name}-${index}`}
                style={[index > 0 && styles.iconSpacing, styles.iconTouch]}
                onPress={onPress}
                activeOpacity={0.76}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel || name.replace(/-/g, " ")}
              >
                <Ionicons name={name} size={20} color="#FFFFFF" style={active ? styles.activeIcon : styles.inactiveIcon} />
                {badge ? (
                  <View style={[styles.badge, { backgroundColor: colors.badge }]}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {rightButton && rightButton}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leftRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },
  backTouch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 8,
    marginLeft: -6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  leftSection: {
    flex: 1,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 11,
    marginTop: 1,
    fontWeight: "500",
    lineHeight: 15,
  },
  rightIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconSpacing: {
    marginLeft: 4,
  },
  iconTouch: {
    position: "relative",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  activeIcon: {
    opacity: 1,
  },
  inactiveIcon: {
    opacity: 0.88,
  },
  badge: {
    position: "absolute",
    top: -1,
    right: -1,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
});
