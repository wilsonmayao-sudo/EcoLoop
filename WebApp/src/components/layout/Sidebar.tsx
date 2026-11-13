import React, { useEffect, useState } from "react";
import { getRuntimeSystemSettings, subscribeRuntimeSettings } from "../../utils/systemSettings";
import {
  LayoutDashboard,
  Map,
  FileText,
  LogOut,
  User,
  Settings,
  X,
  Radio,
  Layers,
  type LucideIcon,
} from "lucide-react";
import svgPaths from "../../assets/icons/sidebarLogo";
import type { PageType } from "../../hooks/useLiveData";

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
  onLogout?: () => void;
  userName?: string;
  userEmail?: string;
  role?: "admin" | "dispatcher" | "supervisor" | "truck_driver";
  allowedPages?: PageType[];
  isOpen?: boolean;
  onClose?: () => void;
}

interface NavGroup {
  label: string;
  items: { id: PageType; label: string; icon: LucideIcon }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "live-monitoring", label: "Live Monitoring", icon: Radio },
    ],
  },
  {
    label: "Fleet & Routing",
    items: [
      { id: "area-management", label: "Areas & Bins", icon: Layers },
      { id: "route-planning", label: "Route Planning", icon: Map },
      { id: "reports", label: "Reports & Issues", icon: FileText },
    ],
  },
  {
    label: "Administration",
    items: [
      { id: "users", label: "Users & Roles", icon: User },
      { id: "system-settings", label: "System Settings", icon: Settings },
    ],
  },
];

function formatRoleBadge(role?: SidebarProps["role"]): string {
  switch (role) {
    case "admin":
      return "Administrator";
    case "dispatcher":
      return "Dispatcher";
    case "supervisor":
      return "Supervisor";
    case "truck_driver":
      return "Truck Driver";
    default:
      return "Staff";
  }
}

export default function Sidebar({
  currentPage,
  onNavigate,
  onLogout,
  userName,
  userEmail,
  role,
  allowedPages = [],
  isOpen = false,
  onClose,
}: SidebarProps) {
  const [organization, setOrganization] = useState(() => getRuntimeSystemSettings().organization);

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setOrganization(getRuntimeSystemSettings().organization);
    });
  }, []);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowedPages.includes(item.id)),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[256px] shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
          isOpen ? "translate-x-0 shadow-xl lg:shadow-none" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-gray-200 px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <svg className="size-5" fill="none" viewBox="0 0 18 18" aria-hidden="true">
                <g clipPath="url(#clip0_sidebar_brand)">
                  <path d={svgPaths.p1fdbe340} fill="white" />
                </g>
                <defs>
                  <clipPath id="clip0_sidebar_brand">
                    <path d="M0 0H18V18H0V0Z" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
            <div className="min-w-0">
              <span className="block truncate text-base font-bold tracking-tight text-gray-900 leading-none">
                {organization.systemTitle || "EcoLoop"}
              </span>
              <span className="mt-1 block truncate text-xs font-medium text-gray-500">
                {organization.city ? `${organization.city} SWMO` : "City of Naga SWMO"}
              </span>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="lg:hidden inline-flex size-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              aria-label="Close navigation menu"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Grouped Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Dashboard sections">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        onNavigate(item.id);
                        onClose?.();
                      }}
                      className={`relative flex w-full min-h-[42px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                        isActive
                          ? "bg-emerald-50 font-semibold text-emerald-900"
                          : "font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-emerald-600"
                          aria-hidden="true"
                        />
                      )}
                      <Icon
                        className={`size-[18px] shrink-0 ${isActive ? "text-emerald-700" : "text-gray-500"}`}
                        aria-hidden={true}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Account Footer */}
        <div className="shrink-0 border-t border-gray-200 bg-gray-50/70 p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <User className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900" title={userName || "Authenticated User"}>
                {userName || "Authenticated User"}
              </p>
              <p className="truncate text-xs text-gray-600" title={userEmail || "Authenticated account"}>
                {userEmail || "Authenticated account"}
              </p>
              <span className="mt-1 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                {formatRoleBadge(role)}
              </span>
            </div>
          </div>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full min-h-[40px] items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
