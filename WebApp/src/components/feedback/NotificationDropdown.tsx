import { useState } from "react";
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

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "success":
        return <CheckCircle className="size-5 text-green-600" />;
      case "error":
        return <AlertCircle className="size-5 text-red-600" />;
      case "warning":
        return <AlertCircle className="size-5 text-amber-600" />;
      case "info":
      default:
        return <Info className="size-5 text-blue-600" />;
    }
  };

  const getNotificationBg = (type: string, read: boolean) => {
    if (read) return "bg-gray-50";
    switch (type) {
      case "success":
        return "bg-green-50";
      case "error":
        return "bg-red-50";
      case "warning":
        return "bg-amber-50";
      case "info":
      default:
        return "bg-blue-50";
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    onViewAll?.();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-gray-100 rounded-lg transition-all"
        title="View Notifications"
      >
        <Bell className="size-5 text-gray-600 hover:text-emerald-600 transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] rounded-full size-4 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[400px] bg-white rounded-lg shadow-2xl border border-gray-200 z-[300] max-h-[600px] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <h3 className="text-gray-900">Notifications</h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  {loading ? "Loading..." : `${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllNotificationsRead()}
                    className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline"
                  >
                    Mark all read
                  </button>
                )}
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {visibleNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Bell className="size-12 text-gray-300 mb-3" />
                  <p className="text-gray-600">{loading ? "Loading notifications..." : "No notifications"}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {visibleNotifications.map((notification) => (
                    <button
                      type="button"
                      key={notification.id}
                      onClick={() => void markNotificationRead(notification.id)}
                      className={`w-full px-4 py-3 text-left cursor-pointer hover:bg-gray-50 transition-colors ${getNotificationBg(notification.type, notification.read)}`}
                    >
                      <div className="flex gap-3">
                        <div className="flex-shrink-0 mt-0.5">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm ${!notification.read ? "text-gray-900" : "text-gray-700"}`}>
                              {notification.title}
                            </p>
                            {!notification.read && <span className="flex-shrink-0 size-2 bg-emerald-500 rounded-full mt-1.5" />}
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{notification.message}</p>
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
              <div className="border-t border-gray-200">
                <button
                  onClick={handleViewAll}
                  className="w-full px-4 py-3 text-emerald-600 hover:bg-emerald-50 transition-colors flex items-center justify-center gap-2"
                >
                  <span className="text-sm">View All Notifications</span>
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
