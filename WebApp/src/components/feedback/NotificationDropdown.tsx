import { useEffect, useState } from "react";
import { Bell, X, AlertCircle, Info, CheckCircle, Clock, ChevronRight } from "lucide-react";
import { relativeTime, useLiveData } from "../../hooks/useLiveData";

interface NotificationDropdownProps {
  onViewAll?: () => void;
}

export default function NotificationDropdown({ onViewAll }: NotificationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, markNotificationRead, markAllNotificationsRead, loading } = useLiveData();
  const visibleNotifications = notifications.slice(0, 5);
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "success":
        return <CheckCircle className="size-5 text-emerald-700" />;
      case "error":
        return <AlertCircle className="size-5 text-red-700" />;
      case "warning":
        return <AlertCircle className="size-5 text-amber-800" />;
      case "info":
      default:
        return <Info className="size-5 text-blue-700" />;
    }
  };

  const getNotificationBg = (type: string, read: boolean) => {
    if (read) return "bg-gray-50/50";
    switch (type) {
      case "success":
        return "bg-emerald-50/60";
      case "error":
        return "bg-red-50/60";
      case "warning":
        return "bg-amber-50/60";
      case "info":
      default:
        return "bg-blue-50/60";
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    onViewAll?.();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 hover:bg-gray-100 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={`View notifications, ${unreadCount} unread`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <Bell className="size-5 text-gray-700 hover:text-emerald-700 transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-semibold rounded-full min-w-4 h-4 px-1 flex items-center justify-center ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Recent notifications"
            className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-[400px] max-w-[400px] bg-white rounded-xl shadow-xl border border-gray-200 z-[300] max-h-[540px] flex flex-col overflow-hidden overscroll-contain animate-slideIn"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50/70">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  {loading ? "Loading..." : `${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllNotificationsRead()}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  aria-label="Close notification panel"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {visibleNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Bell className="size-10 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-600">{loading ? "Loading notifications..." : "No notifications right now"}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {visibleNotifications.map((notification) => (
                    <button
                      type="button"
                      key={notification.id}
                      onClick={() => void markNotificationRead(notification.id)}
                      className={`w-full px-4 py-3 text-left cursor-pointer hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${getNotificationBg(notification.type, notification.read)}`}
                    >
                      <div className="flex gap-3">
                        <div className="flex-shrink-0 mt-0.5">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm ${!notification.read ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                              {notification.title}
                            </p>
                            {!notification.read && <span className="flex-shrink-0 size-2 bg-emerald-600 rounded-full mt-1.5" />}
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">{notification.message}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Clock className="size-3 text-gray-400" />
                            <span className="text-xs text-gray-500">{relativeTime(notification.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="border-t border-gray-200 bg-gray-50/50 p-2">
                <button
                  type="button"
                  onClick={handleViewAll}
                  className="w-full py-2 px-3 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <span>View All Notifications</span>
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
