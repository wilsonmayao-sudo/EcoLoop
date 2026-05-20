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
                activeOpacity={0.76}
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
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
    width: 34,
    height: 34,
    borderRadius: 17,
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
