import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  colorClassName?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  ariaLabel = "Select option",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, minWidth: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(240, Math.max(48, options.length * 38 + 8));
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUp = spaceBelow < menuHeight + gap && rect.top > spaceBelow;

    setMenuPosition({
      top: shouldOpenUp ? Math.max(gap, rect.top - menuHeight - gap) : rect.bottom + gap,
      left: Math.max(gap, Math.min(rect.left, window.innerWidth - rect.width - gap)),
      minWidth: rect.width,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return undefined;

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
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
        className={`flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName}`}
      >
        <span className={`flex min-w-0 items-center gap-2 ${selectedOption ? "" : "text-gray-400"}`}>
          {selectedOption?.colorClassName && <span className={`size-2 shrink-0 rounded-full ${selectedOption.colorClassName}`} />}
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div
          className={`fixed z-[350] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg ${menuClassName}`}
          style={{ top: menuPosition.top, left: menuPosition.left, minWidth: menuPosition.minWidth }}
        >
          <div role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  setOpen(false);
                  onChange(option.value);
                }}
                className={`block w-full px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  option.value === value ? "bg-emerald-50 text-emerald-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.colorClassName && <span className={`size-2 shrink-0 rounded-full ${option.colorClassName}`} />}
                  <span className="truncate">{option.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
