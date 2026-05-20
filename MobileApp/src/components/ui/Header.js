import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";

export default function Header({ title, subtitle = "City of Naga", rightIcons, rightButton }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.headerBg }]}>
      <View style={styles.leftSection}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {rightIcons && (
        <View style={styles.rightIcons}>
          {rightIcons.map((iconItem, index) => {
            const item = typeof iconItem === "string" ? { name: iconItem } : iconItem;
            const { name, onPress, active, badge } = item;
            return (
              <TouchableOpacity
                key={`${name}-${index}`}
                style={[index > 0 && styles.iconSpacing, styles.iconTouch]}
                onPress={onPress}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leftSection: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  rightIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconSpacing: {
    marginLeft: 2,
  },
  iconTouch: {
    position: "relative",
    padding: 4,
  },
  activeIcon: {
    opacity: 1,
  },
  inactiveIcon: {
    opacity: 0.88,
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
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
