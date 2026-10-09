import { ClipboardList, Radio, Shield } from "lucide-react";
import { useAuth, type AppRole } from "../../contexts/AuthContext";

const ROLE_CONFIG: Record<
  Exclude<AppRole, "truck_driver">,
  { label: string; icon: typeof Shield; bg: string; text: string; border: string; iconColor: string }
> = {
  admin: {
    label: "Admin Dashboard",
    icon: Shield,
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    iconColor: "text-red-600",
  },
  dispatcher: {
    label: "Dispatcher Dashboard",
    icon: Radio,
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    iconColor: "text-blue-600",
  },
  supervisor: {
    label: "Supervisor Dashboard",
    icon: ClipboardList,
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
    iconColor: "text-green-600",
  },
};

export default function RoleIndicator() {
  const { profile } = useAuth();
  const role = profile?.role;

  if (!role || role === "truck_driver") return null;

  const config = ROLE_CONFIG[role];
  const Icon = config.icon;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text} ${config.border}`}
      aria-label={config.label}
    >
      <Icon className={`size-3.5 shrink-0 ${config.iconColor}`} aria-hidden />
      <span>{config.label}</span>
    </div>
  );
}
