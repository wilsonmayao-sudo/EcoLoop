import type { ReactNode } from "react";
import NotificationDropdown from "../feedback/NotificationDropdown";
import { formatDateOnly } from "../../hooks/useLiveData";
import type { PageType } from "../../hooks/useLiveData";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  onNavigate?: (page: PageType) => void;
  showDate?: boolean;
  showNotifications?: boolean;
}

/**
 * Shared municipal header bar for consistent typography, actions, date context, and notifications.
 */
export default function PageHeader({
  title,
  subtitle = "City of Naga Waste Collection Management",
  description,
  icon,
  badge,
  actions,
  onNavigate,
  showDate = true,
  showNotifications = true,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-gray-200/80 pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {icon ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{title}</h1>
              {badge}
            </div>
            {subtitle ? <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p> : null}
          </div>
        </div>
        {description ? <p className="mt-2 text-xs font-medium text-emerald-800">{description}</p> : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 self-end sm:self-auto">
        {actions}
        {showDate ? (
          <div className="hidden text-right sm:block border-r border-gray-200 pr-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today</div>
            <div className="text-xs font-medium text-gray-800">{formatDateOnly(new Date().toISOString())}</div>
          </div>
        ) : null}
        {showNotifications && onNavigate ? (
          <NotificationDropdown onViewAll={() => onNavigate("notifications")} />
        ) : null}
      </div>
    </header>
  );
}
