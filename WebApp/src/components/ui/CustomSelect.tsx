import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  colorClassName?: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
}

const SIZE_TRIGGER_CLASSES: Record<"sm" | "md", string> = {
  sm: "h-9 px-2.5 py-1.5 text-xs",
  md: "h-10 px-3 py-2 text-sm",
};

const SIZE_MENU_CLASSES: Record<"sm" | "md", string> = {
  sm: "text-xs",
  md: "text-sm",
};

export default function CustomSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  size = "md",
  className = "",
  buttonClassName = "",
  menuClassName = "",
  ariaLabel = "Select option",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, minWidth: 0, maxWidth: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const hasSelectedValue = Boolean(selectedOption && selectedOption.label);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const rowHeight = size === "sm" ? 34 : 38;
    const menuHeight = Math.min(256, Math.max(48, options.length * rowHeight + 8));
    const gap = 4;
    const maxWidth = Math.max(160, window.innerWidth - gap * 2);
    const minWidth = Math.min(rect.width, maxWidth);
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUp = spaceBelow < menuHeight + gap && rect.top > spaceBelow;

    setMenuPosition({
      top: shouldOpenUp ? Math.max(gap, rect.top - menuHeight - gap) : rect.bottom + gap,
      left: Math.max(gap, Math.min(rect.left, window.innerWidth - minWidth - gap)),
      minWidth,
      maxWidth,
    });
  }, [options.length, size]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const enabledOptions = options.filter((o) => !o.disabled);
        if (enabledOptions.length === 0) return;
        const idx = enabledOptions.findIndex((o) => o.value === value);
        const nextIdx =
          e.key === "ArrowDown"
            ? (idx + 1) % enabledOptions.length
            : (idx - 1 + enabledOptions.length) % enabledOptions.length;
        onChange(enabledOptions[nextIdx].value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, options, value, onChange, updateMenuPosition]);

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          updateMenuPosition();
          setOpen((current) => !current);
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white text-left font-medium shadow-2xs transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:opacity-75 ${
          open ? "border-emerald-600 ring-2 ring-emerald-500/20" : "border-gray-300 hover:border-gray-400"
        } ${SIZE_TRIGGER_CLASSES[size]} ${buttonClassName}`}
      >
        <span
          className={`flex min-w-0 items-center gap-2 ${
            hasSelectedValue ? "text-gray-800" : "font-normal text-gray-400"
          }`}
        >
          {selectedOption?.colorClassName && (
            <span className={`size-2 shrink-0 rounded-full ${selectedOption.colorClassName}`} />
          )}
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180 text-emerald-600" : "text-gray-500"
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={`fixed z-[350] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg overscroll-contain ${SIZE_MENU_CLASSES[size]} ${menuClassName}`}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            minWidth: menuPosition.minWidth,
            maxWidth: menuPosition.maxWidth,
          }}
        >
          <div role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    setOpen(false);
                    onChange(option.value);
                    triggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "bg-emerald-50 font-semibold text-emerald-800"
                      : "font-normal text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.colorClassName && (
                      <span className={`size-2 shrink-0 rounded-full ${option.colorClassName}`} />
                    )}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {selected && (
                    <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
