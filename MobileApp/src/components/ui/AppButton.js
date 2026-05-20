import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";

/**
 * Primary / secondary / outline / muted actions — consistent height, padding, and corners app-wide.
 */
export default function AppButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  iconPosition = "left",
  fullWidth = true,
  style,
  textStyle,
  accessibilityLabel,
}) {
  const { colors } = useTheme();

  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "secondary"
        ? colors.actionSecondary
        : variant === "muted"
          ? colors.actionMuted
          : "transparent";

  const borderColor = variant === "outline" ? colors.primary : variant === "outlineMuted" ? colors.borderSubtle : "transparent";
  const borderWidth = variant === "outline" || variant === "outlineMuted" ? 1 : 0;

  const labelColor =
    variant === "outline" || variant === "outlineMuted"
      ? variant === "outlineMuted"
        ? colors.textPrimary
        : colors.primary
      : "#FFFFFF";

  const iconColor = textStyle?.color ?? labelColor;
  const isOutline = variant === "outline" || variant === "outlineMuted";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        {
          backgroundColor: isOutline ? colors.card : bg,
          borderColor,
          borderWidth,
          opacity: disabled && !loading ? 0.62 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textStyle?.color ?? labelColor} size="small" />
      ) : (
        <View style={styles.inner}>
          {icon && iconPosition === "left" ? (
            <Ionicons name={icon} size={20} color={iconColor} style={styles.iconLeft} />
          ) : null}
          <Text style={[styles.label, { color: labelColor }, textStyle]} numberOfLines={2}>
            {title}
          </Text>
          {icon && iconPosition === "right" ? (
            <Ionicons name={icon} size={20} color={iconColor} style={styles.iconRight} />
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.1,
    textAlign: "center",
  },
  iconLeft: { marginRight: 0 },
  iconRight: { marginLeft: 0 },
});
