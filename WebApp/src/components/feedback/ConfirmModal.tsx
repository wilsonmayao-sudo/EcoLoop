import { useEffect, useState } from "react";
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
  variant = "warning"
}: ConfirmModalProps) {
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    if (isOpen) setConfirmBusy(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const colors = {
    danger: {
      bg: "bg-red-100",
      text: "text-red-600",
      button: "from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 shadow-red-500/30"
    },
    warning: {
      bg: "bg-amber-100",
      text: "text-amber-600",
      button: "from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 shadow-amber-500/30"
    },
    info: {
      bg: "bg-blue-100",
      text: "text-blue-600",
      button: "from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 shadow-blue-500/30"
    }
  };

  const currentColor = colors[variant];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[400]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${currentColor.bg} rounded-full`}>
              <AlertCircle className={`size-6 ${currentColor.text}`} />
            </div>
            <h3 className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="font-['Poppins:Regular',sans-serif] text-gray-700">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-['Poppins:Medium',sans-serif] transition-all"
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
            className={`flex-1 px-4 py-2.5 bg-gradient-to-r text-white rounded-lg font-['Poppins:Medium',sans-serif] transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${currentColor.button}`}
          >
            {confirmBusy ? "Please wait…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
