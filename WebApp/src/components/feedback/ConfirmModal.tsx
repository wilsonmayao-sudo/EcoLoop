import { useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "warning",
}: ConfirmModalProps) {
  const [confirmBusy, setConfirmBusy] = useState(false);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmBusy(false);
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => cancelBtnRef.current?.focus());
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmBusy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, confirmBusy, onClose]);

  if (!isOpen) return null;

  const colors = {
    danger: {
      bg: "bg-red-50 border border-red-200",
      text: "text-red-700",
      button: "bg-red-600 hover:bg-red-700 focus-visible:ring-red-600",
    },
    warning: {
      bg: "bg-amber-50 border border-amber-200",
      text: "text-amber-800",
      button: "bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-600",
    },
    info: {
      bg: "bg-emerald-50 border border-emerald-200",
      text: "text-emerald-700",
      button: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-600",
    },
  };

  const currentColor = colors[variant];

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4 overscroll-contain"
      onClick={() => {
        if (!confirmBusy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
    >
      <div
        className="w-[460px] max-w-[95vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${currentColor.bg}`}>
              <AlertCircle className={`size-5 ${currentColor.text}`} aria-hidden="true" />
            </div>
            <h2 id="confirm-modal-title" className="text-base font-semibold text-gray-900 sm:text-lg">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={confirmBusy}
            className="inline-flex size-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <p id="confirm-modal-desc" className="text-sm leading-relaxed text-gray-700">
            {message}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onClose}
            disabled={confirmBusy}
            className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={confirmBusy}
            onClick={() => {
              void (async () => {
                try {
                  setConfirmBusy(true);
                  await Promise.resolve(onConfirm());
                  onClose();
                } catch {
                  /* Keep modal open; caller should surface errors (e.g. toast). */
                } finally {
                  setConfirmBusy(false);
                }
              })();
            }}
            className={`min-h-[44px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${currentColor.button}`}
          >
            {confirmBusy ? "Please wait…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
