import React from "react";
import { LayoutDashboard, Map, Truck, FileText, MapPin, LogOut, User, UserCheck, Settings, Activity } from "lucide-react";
import svgPaths from "../../assets/icons/sidebarLogo";

type PageType =
  | "dashboard"
  | "route-planning"
  | "vehicle-monitoring"
  | "reports"
  | "bin-locations"
  | "notifications"
  | "users"
  | "user-approvals"
  | "supervisor-dashboard"
  | "system-settings";

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
  onLogout?: () => void;
  userName?: string;
  userEmail?: string;
  role?: "admin" | "dispatcher" | "supervisor" | "truck_driver";
  allowedPages?: PageType[];
}

export default function Sidebar({ currentPage, onNavigate, onLogout, userName, userEmail, role, allowedPages = [] }: SidebarProps) {
  const allMenuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "supervisor-dashboard", label: "Operations", icon: Activity },
    { id: "route-planning", label: "Route Planning", icon: Map },
    { id: "vehicle-monitoring", label: "Vehicle Monitoring", icon: Truck },
    { id: "reports", label: "Reports & Issues", icon: FileText },
    { id: "bin-locations", label: "Bin Locations", icon: MapPin },
    { id: "users", label: "Users", icon: User },
    { id: "user-approvals", label: "Pending accounts", icon: UserCheck },
    { id: "system-settings", label: "System Settings", icon: Settings },
  ];
  const menuItems = allMenuItems.filter((item) => {
    if (role === "admin" && item.id === "bin-locations") return false;
    return allowedPages.includes(item.id as PageType);
  });

  return (
    <div className="fixed left-0 top-0 h-full w-[256px] bg-white border-r border-gray-200 shadow-sm flex flex-col z-50">
      {/* Logo Section */}
      <div className="h-[72px] flex items-center px-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 rounded-lg p-2">
            <svg className="size-6" fill="none" viewBox="0 0 18 18">
              <g clipPath="url(#clip0_1_714)">
                <path d={svgPaths.p1fdbe340} fill="white" />
              </g>
              <defs>
                <clipPath id="clip0_1_714">
                  <path d="M0 0H18V18H0V0Z" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </div>
          <div>
            <h1 className="font-['Poppins:Bold',sans-serif] text-lg text-gray-900">
              ECOLOOP
            </h1>
            <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500">
              City of Naga
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 py-6 px-3 overflow-y-auto">
        <div className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id as PageType)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <Icon className={`size-5 ${isActive ? "text-white" : "text-gray-600"}`} />
                <span className={`font-['Poppins:Medium',sans-serif] text-sm ${
                  isActive ? "text-white" : "text-gray-700"
                }`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Admin Profile Section */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-emerald-600 rounded-full size-10 flex items-center justify-center">
            <User className="size-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-['Poppins:SemiBold',sans-serif] text-sm text-gray-900 truncate">
              {userName || "Authenticated User"}
            </p>
            <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500 truncate">
              {userEmail || "Authenticated account"}
            </p>
          </div>
        </div>

        {/* Logout Button */}
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <LogOut className="size-4" />
            <span className="font-['Poppins:Medium',sans-serif] text-sm">Logout</span>
          </button>
        )}
      </div>
    </div>
  );
}
