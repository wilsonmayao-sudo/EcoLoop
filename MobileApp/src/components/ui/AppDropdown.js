import React, { useMemo, useState } from "react";
import { Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import { designTokens } from "../../theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

/**
 * Shared dropdown field and option picker modal styled with EcoLoop's design tokens.
 * Supports either the default form field trigger or a custom trigger via `renderTrigger`.
 */
export default function AppDropdown({
  label,
  value,
  options = [],
  onSelect,
  placeholder = "Select option",
  disabled = false,
  expanded: controlledExpanded,
  onToggle,
  renderTrigger,
  style,
}) {
  const { colors } = useTheme();
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = typeof controlledExpanded === "boolean" && typeof onToggle === "function";
  const isOpen = isControlled ? controlledExpanded : internalOpen;

  const setOpen = (next) => {
    if (disabled) return;
    if (isControlled) {
      onToggle();
    } else {
      setInternalOpen(typeof next === "function" ? next : Boolean(next));
    }
  };

  const normalizedOptions = useMemo(
    () =>
      options.map((opt) =>
        typeof opt === "string" ? { value: opt, label: opt } : opt,
      ),
    [options],
  );

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  return (
    <View style={style}>
      {renderTrigger ? (
        renderTrigger({
          open: isOpen,
          selectedLabel: selectedOption?.label ?? placeholder,
          onPress: () => setOpen((prev) => !prev),
        })
      ) : (
        <TouchableOpacity
          activeOpacity={0.75}
          disabled={disabled}
          onPress={() => setOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen, disabled }}
          style={[
            styles.trigger,
            {
              backgroundColor: colors.card,
              borderColor: isOpen ? colors.primary : colors.borderSubtle,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.triggerText,
              {
                color: selectedOption ? colors.textPrimary : colors.textSecondary,
                fontWeight: selectedOption ? "600" : "400",
              },
            ]}
          >
            {selectedOption?.label ?? placeholder}
          </Text>
          <Ionicons
            name={isOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={isOpen ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      <Modal
        transparent
        visible={isOpen}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View
            style={[
              styles.menuCard,
              designTokens.shadow.cardRaised,
              {
                backgroundColor: colors.card,
                borderColor: colors.borderSubtle,
                maxHeight: SCREEN_HEIGHT * 0.55,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {label ? (
              <View style={[styles.menuHeader, { borderBottomColor: colors.borderSubtle }]}>
                <Text style={[styles.menuHeaderText, { color: colors.textSecondary }]}>
                  {label}
                </Text>
                <TouchableOpacity onPress={() => setOpen(false)} hitSlop={designTokens.hitSlop}>
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}

            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {normalizedOptions.map((opt, index) => {
                const selected = opt.value === value;
                const isLast = index === normalizedOptions.length - 1;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.75}
                    disabled={opt.disabled}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected, disabled: Boolean(opt.disabled) }}
                    onPress={() => {
                      if (opt.disabled) return;
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.optionRow,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
                      selected && { backgroundColor: colors.primary + "15" },
                      opt.disabled && { opacity: 0.5 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: selected ? colors.primary : colors.textPrimary,
                          fontWeight: selected ? "700" : "500",
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: designTokens.minTouch,
    borderWidth: 1,
    borderRadius: designTokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: designTokens.space.sm,
  },
  triggerText: {
    flex: 1,
    fontSize: designTokens.font.body,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: designTokens.space.xl,
  },
  menuCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: designTokens.radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: designTokens.space.lg,
    paddingVertical: designTokens.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuHeaderText: {
    fontSize: designTokens.font.label,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  optionRow: {
    minHeight: designTokens.minTouch,
    paddingHorizontal: designTokens.space.lg,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: designTokens.space.md,
  },
  optionText: {
    flex: 1,
    fontSize: designTokens.font.bodyLarge,
  },
});
