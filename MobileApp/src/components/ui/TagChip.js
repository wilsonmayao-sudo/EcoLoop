import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../context/ThemeContext";

/**
 * @param {string} [color] — accent color (used for tint + label when overrides omitted)
 * @param {string} [backgroundColor] — explicit chip background
 * @param {string} [textColor] — explicit label color
 */
export default function TagChip({ label, color, backgroundColor, textColor }) {
  const { colors, tokens } = useTheme();
  const chipColor = color || colors.primary;
  const bg = backgroundColor ?? chipColor + "22";
  const fg = textColor ?? chipColor;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: bg,
          borderRadius: tokens.radius.full,
          paddingHorizontal: tokens.space.sm + 2,
          paddingVertical: tokens.space.xs + 2,
        },
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "flex-start",
  },
  label: {
    fontWeight: "700",
    fontSize: 12,
  },
});
