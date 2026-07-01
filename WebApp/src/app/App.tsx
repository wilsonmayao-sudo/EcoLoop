import React, { type ReactNode, useState } from "react";
import ProfessionalDashboard from "../pages/ProfessionalDashboard";
import RoutePlanning from "../pages/RoutePlanning";
import BinLocations from "../pages/BinLocations";
import Notifications from "../pages/Notifications";
import Sidebar from "../components/layout/Sidebar";
import ReportsAndIssues from "../pages/ReportsAndIssues";
import VehicleMonitoringWithActions from "../pages/VehicleMonitoringWithActions";
import WelcomeScreen from "../features/auth/WelcomeScreen";
import UserApprovals from "../pages/UserApprovals";
import SupervisorDashboard from "../pages/SupervisorDashboard";
import SystemSettings from "../pages/SystemSettings";
import { AuthProvider, useAuth, type AppRole } from "../contexts/AuthContext";
import { useRolePermissions, type PageType } from "../hooks/useLiveData";

const FALLBACK_PAGE_ACCESS: Record<Exclude<AppRole, "truck_driver">, PageType[]> = {
  admin: ["dashboard", "reports", "bin-locations", "notifications", "user-approvals", "system-settings"],
  dispatcher: ["dashboard", "route-planning", "vehicle-monitoring", "reports", "bin-locations", "notifications"],
  supervisor: ["supervisor-dashboard", "reports", "notifications"],
};

/** Matches sidebar menu order — first allowed page is the default on load/refresh. */
const SIDEBAR_PAGE_ORDER: PageType[] = [
  "dashboard",
  "supervisor-dashboard",
  "route-planning",
  "vehicle-monitoring",
  "reports",
  "bin-locations",
  "notifications",
  "user-approvals",
  "system-settings",
];

function getDefaultPage(readablePages: PageType[]): PageType {
  return SIDEBAR_PAGE_ORDER.find((page) => readablePages.includes(page)) ?? readablePages[0] ?? "dashboard";
}

function AppShell() {
  const [currentPage, setCurrentPage] = useState(null as PageType | null);
  const { loading, session, profile, authError, signOut } = useAuth();
  const { readablePages, loading: permissionsLoading, error: permissionsError } = useRolePermissions(profile?.role);
  const effectiveReadablePages =
    readablePages.length > 0
      ? readablePages
      : profile?.role && profile.role !== "truck_driver"
        ? FALLBACK_PAGE_ACCESS[profile.role]
        : [];

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
  };

  const renderPage = () => {
    const pageToRender = activePage;
    switch (pageToRender) {
      case "dashboard":
        return <ProfessionalDashboard onNavigate={navigateWithRoleGuard} role={profile.role} />;
      case "supervisor-dashboard":
        return <SupervisorDashboard onNavigate={navigateWithRoleGuard} />;
      case "user-approvals":
        return <UserApprovals onNavigate={navigateWithRoleGuard} />;
      case "system-settings":
        return <SystemSettings onNavigate={navigateWithRoleGuard} />;
      case "route-planning":
        return <RoutePlanning onNavigate={navigateWithRoleGuard} />;
      case "vehicle-monitoring":
        return <VehicleMonitoringWithActions 
          onNavigateToRoutePlanning={() => navigateWithRoleGuard("route-planning")}
          onNavigateToReports={() => navigateWithRoleGuard("reports")}
          onNavigate={navigateWithRoleGuard}
        />; 
      case "reports":
        return <ReportsAndIssues onNavigate={navigateWithRoleGuard} />; 
      case "bin-locations":
        return <BinLocations onNavigate={navigateWithRoleGuard} />;
      case "notifications":
        return <Notifications />;
      default:
        return <ProfessionalDashboard onNavigate={navigateWithRoleGuard} />;
    }
  };

  return (
    <div className="relative w-full h-screen bg-gray-50 overflow-hidden flex">
      {permissionsError && (
        <div className="fixed top-4 right-4 z-[500] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {permissionsError}
        </div>
      )}
      {/* Sidebar */}
      <Sidebar
        currentPage={activePage}
        onNavigate={navigateWithRoleGuard}
        onLogout={signOut}
        userName={profile.full_name}
        userEmail={profile.email}
        role={profile.role}
        allowedPages={effectiveReadablePages}
      />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Page Content - Scrollable */}
        <div className="flex-1 overflow-hidden bg-gray-50">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <AppShell />
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