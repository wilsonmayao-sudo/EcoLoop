import React, { Suspense, lazy, type ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import svgPaths from "../assets/icons/sidebarLogo";
import Sidebar from "../components/layout/Sidebar";
import WelcomeScreen from "../features/auth/WelcomeScreen";
import { AuthProvider, useAuth, type AppRole } from "../contexts/AuthContext";
import { LiveDataProvider, useRolePermissions, type PageType } from "../hooks/useLiveData";
import { supabaseConfigError } from "../services/supabaseClient";

const ProfessionalDashboard = lazy(() => import("../pages/ProfessionalDashboard"));
const RoutePlanning = lazy(() => import("../pages/RoutePlanning"));
const Notifications = lazy(() => import("../pages/Notifications"));
const ReportsAndIssues = lazy(() => import("../pages/ReportsAndIssues"));
const Users = lazy(() => import("../pages/Users"));
const SystemSettings = lazy(() => import("../pages/SystemSettings"));
const LiveMonitoring = lazy(() => import("../pages/LiveMonitoring"));
const AreaManagement = lazy(() => import("../pages/AreaManagement"));

const FALLBACK_PAGE_ACCESS: Record<Exclude<AppRole, "truck_driver">, PageType[]> = {
  admin: [
    "dashboard",
    "live-monitoring",
    "area-management",
    "route-planning",
    "reports",
    "notifications",
    "users",
    "system-settings",
  ],
  dispatcher: [
    "dashboard",
    "live-monitoring",
    "area-management",
    "route-planning",
    "reports",
    "notifications",
  ],
  supervisor: [
    "dashboard",
    "live-monitoring",
    "area-management",
    "route-planning",
    "reports",
    "notifications",
  ],
};

/** Matches sidebar menu order — first allowed page is the default on load/refresh. */
const SIDEBAR_PAGE_ORDER: PageType[] = [
  "dashboard",
  "live-monitoring",
  "area-management",
  "route-planning",
  "reports",
  "notifications",
  "users",
  "system-settings",
];

function getDefaultPage(readablePages: PageType[]): PageType {
  return SIDEBAR_PAGE_ORDER.find((page) => readablePages.includes(page)) ?? readablePages[0] ?? "dashboard";
}

const PAGE_LABELS: Record<PageType, string> = {
  dashboard: "Dashboard",
  "live-monitoring": "Live Monitoring",
  "area-management": "Areas & Bins",
  "route-planning": "Route Planning",
  reports: "Reports & Issues",
  notifications: "Notifications",
  users: "Users & Roles",
  "system-settings": "System Settings",
};

function AppShell() {
  const [currentPage, setCurrentPage] = useState(null as PageType | null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [usersInitialFilter, setUsersInitialFilter] = useState<"total" | "pending" | "active">("total");
  const { loading, session, profile, authError, signOut } = useAuth();
  const { readablePages, loading: permissionsLoading, error: permissionsError } = useRolePermissions(profile?.role);
  const effectiveReadablePages = React.useMemo(() => {
    if (!profile?.role) return [];
    const roleLower = profile.role.toLowerCase() as AppRole;
    if (roleLower === "truck_driver") return [];
    const normalizedRole = roleLower as Exclude<AppRole, "truck_driver">;
    const base = readablePages.length > 0 ? readablePages : FALLBACK_PAGE_ACCESS[normalizedRole] || [];
    const set = new Set<PageType>(base);

    // Guaranteed access to live monitoring and areas & bins
    set.add("live-monitoring");
    set.add("area-management");

    if (normalizedRole === "admin") {
      set.add("users");
      set.add("system-settings");
    } else {
      // Strictly restrict account management to Admin accounts
      set.delete("users");
    }

    return Array.from(set);
  }, [profile?.role, readablePages]);

  const defaultPage = getDefaultPage(effectiveReadablePages);
  const activePage =
    currentPage && effectiveReadablePages.includes(currentPage) ? currentPage : defaultPage;

  if (loading || (profile && permissionsLoading)) {
    return <div className="w-full h-screen flex items-center justify-center bg-gray-50 text-gray-700">Loading…</div>;
  }

  // Show welcome/auth screen when logged out or role/profile invalid
  if (!session || !profile) {
    return <WelcomeScreen initialError={authError} />;
  }

  const navigateWithRoleGuard = (page: PageType) => {
    if (!profile) return;
    if (!effectiveReadablePages.includes(page)) {
      setCurrentPage(defaultPage);
      return;
    }
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  const navigateToUsers = (filter: "total" | "pending" | "active") => {
    setUsersInitialFilter(filter);
    navigateWithRoleGuard("users");
  };

  const renderPage = () => {
    const pageToRender = activePage;
    switch (pageToRender) {
      case "dashboard":
        return <ProfessionalDashboard onNavigate={navigateWithRoleGuard} onNavigateUsers={navigateToUsers} role={profile.role} />;
      case "users":
        return <Users onNavigate={navigateWithRoleGuard} initialFilter={usersInitialFilter} role={profile.role} />;
      case "system-settings":
        return <SystemSettings onNavigate={navigateWithRoleGuard} />;
      case "route-planning":
        return <RoutePlanning onNavigate={navigateWithRoleGuard} />;
      case "live-monitoring":
        return <LiveMonitoring onNavigate={navigateWithRoleGuard} role={profile.role} />;
      case "area-management":
        return <AreaManagement onNavigate={navigateWithRoleGuard} />;
      case "reports":
        return <ReportsAndIssues onNavigate={navigateWithRoleGuard} />;
      case "notifications":
        return <Notifications />;
      default:
        return <ProfessionalDashboard onNavigate={navigateWithRoleGuard} onNavigateUsers={navigateToUsers} role={profile.role} />;
    }
  };

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-gray-50 lg:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[600] focus:rounded-lg focus:bg-emerald-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Skip to main content
      </a>

      {permissionsError && (
        <div className="fixed top-4 right-4 z-[500] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-md">
          {permissionsError}
        </div>
      )}

      {/* Mobile Top Header */}
      <header className="flex h-14 w-full shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 z-30 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex size-10 -ml-1.5 items-center justify-center rounded-lg text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
              <svg className="size-4" fill="none" viewBox="0 0 18 18" aria-hidden="true">
                <g clipPath="url(#clip0_mobile_hdr)">
                  <path d={svgPaths.p1fdbe340} fill="white" />
                </g>
                <defs>
                  <clipPath id="clip0_mobile_hdr">
                    <path d="M0 0H18V18H0V0Z" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
            <span className="truncate text-sm font-bold tracking-tight text-gray-900">
              {PAGE_LABELS[activePage] ?? "EcoLoop"}
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 border border-emerald-200">
          {profile.role}
        </span>
      </header>

      {/* Sidebar */}
      <Sidebar
        currentPage={activePage}
        onNavigate={navigateWithRoleGuard}
        onLogout={signOut}
        userName={profile.full_name}
        userEmail={profile.email}
        role={profile.role}
        allowedPages={effectiveReadablePages}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 h-[calc(100vh-3.5rem)] lg:h-screen overflow-y-auto bg-gray-50 p-4 sm:p-6 lg:p-8 focus:outline-none"
      >
        <Suspense
          fallback={
            <div className="flex h-64 w-full items-center justify-center text-sm text-gray-600">
              Loading module…
            </div>
          }
        >
          {renderPage()}
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  if (supabaseConfigError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-lg">!</div>
            <h1 className="text-xl font-semibold text-red-700">Configuration Required</h1>
          </div>
          <p className="text-sm text-gray-700 mb-3">{supabaseConfigError}</p>
          <p className="text-xs text-gray-500">
            Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment (.env.local or production environment).
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <AppErrorBoundary>
        <LiveDataProvider>
          <AppShell />
        </LiveDataProvider>
      </AppErrorBoundary>
    </AuthProvider>
  );
}

class AppErrorBoundary extends React.Component<{ children?: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-red-700 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-700 mb-4">
              EcoLoop could not load this screen. Refresh the page or try again in a moment. If the problem continues, contact your administrator.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
