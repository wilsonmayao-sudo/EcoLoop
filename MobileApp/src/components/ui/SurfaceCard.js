import React from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "../../context/ThemeContext";

export default function SurfaceCard({ children, style, padding = "lg", elevated = true }) {
  const { colors, tokens } = useTheme();
  const pad = typeof padding === "number" ? padding : tokens.space[padding] ?? tokens.space.lg;

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: colors.card,
          borderRadius: tokens.radius.xl,
          padding: pad,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSubtle,
        },
        elevated ? tokens.shadow.card : {},
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
  },
});
