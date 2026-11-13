import { useEffect } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

interface ToastProps {
  isOpen?: boolean;
  onClose: () => void;
  message: string;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
}

export default function Toast({ isOpen = true, onClose, message, type = "success", duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  const configs = {
    success: {
      bg: "bg-emerald-50 border-emerald-200",
      icon: <CheckCircle className="size-5 text-emerald-600" />,
      text: "text-emerald-900",
      progress: "bg-emerald-500"
    },
    error: {
      bg: "bg-red-50 border-red-200",
      icon: <AlertCircle className="size-5 text-red-600" />,
      text: "text-red-900",
      progress: "bg-red-500"
    },
    warning: {
      bg: "bg-amber-50 border-amber-200",
      icon: <AlertCircle className="size-5 text-amber-600" />,
      text: "text-amber-900",
      progress: "bg-amber-500"
    },
    info: {
      bg: "bg-blue-50 border-blue-200",
      icon: <Info className="size-5 text-blue-600" />,
      text: "text-blue-900",
      progress: "bg-blue-500"
    }
  };

  const config = configs[type];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 left-4 sm:left-auto sm:right-6 sm:top-6 z-[500] animate-slideIn"
    >
      <div className={`flex items-center gap-3 ${config.bg} border rounded-xl shadow-lg p-4 pr-3 min-w-0 sm:min-w-[320px] max-w-full sm:max-w-[420px]`}>
        <div className="flex-shrink-0">
          {config.icon}
        </div>
        <p className={`flex-1 font-medium text-sm ${config.text}`}>
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notification"
          className={`flex-shrink-0 p-1 rounded-lg ${config.text} hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current transition-all`}
        >
          <X className="size-4" />
        </button>
      </div>
      {/* Progress bar */}
      {duration > 0 && (
        <div className="h-1 bg-gray-200/80 rounded-b-xl overflow-hidden mt-[-4px]">
          <div 
            className={`h-full ${config.progress} animate-shrink`}
            style={{ animationDuration: `${duration}ms` }}
          />
        </div>
      )}
    </div>
  );
}