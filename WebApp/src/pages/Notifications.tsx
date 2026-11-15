import { useMemo, useState } from "react";
import { Bell, Check, Trash2, AlertCircle, Info, CheckCircle, X } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import PageHeader from "../components/layout/PageHeader";
import { relativeTime, useLiveData } from "../hooks/useLiveData";

type NotificationFilter = "all" | "unread";

export default function Notifications() {
  const {
    notifications,
    loading,
    error,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearReadNotifications,
  } = useLiveData();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((notification) => {
        if (filter === "unread") return !notification.read;
        return true;
      }),
    [filter, notifications],
  );

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const todayCount = notifications.filter((notification) => new Date(notification.created_at).toDateString() === new Date().toDateString()).length;

  const getTypeIcon = (type: string) => {
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

  const getTypeBg = (type: string) => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "warning":
        return "bg-amber-50 border-amber-200";
      case "info":
      default:
        return "bg-blue-50 border-blue-200";
    }
  };

  const handleDelete = (id: string) => {
    setNotificationToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (notificationToDelete) {
      await deleteNotification(notificationToDelete);
    }
    setShowDeleteConfirm(false);
    setNotificationToDelete(null);
  };

  const confirmClearAll = async () => {
    await clearReadNotifications();
    setShowClearAllConfirm(false);
  };

  const filters: NotificationFilter[] = ["all", "unread"];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Notifications"
        subtitle="System alerts, route notifications, and account updates"
        icon={<Bell className="size-5" aria-hidden="true" />}
        showNotifications={false}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Total</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1.5">{loading ? "..." : notifications.length}</div>
          <div className="text-blue-700 font-medium text-xs mt-1">All notifications</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Unread</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1.5">{loading ? "..." : unreadCount}</div>
          <div className="text-amber-800 font-medium text-xs mt-1">Needs attention</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Critical</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1.5">{loading ? "..." : notifications.filter((notification) => notification.type === "error").length}</div>
          <div className="text-red-700 font-medium text-xs mt-1">High priority</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Today</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1.5">{loading ? "..." : todayCount}</div>
          <div className="text-emerald-700 font-medium text-xs mt-1">Recent updates</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  filter === item ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {item === "unread" ? `Unread (${unreadCount})` : item}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void markAllNotificationsRead()}
              className="inline-flex min-h-[40px] items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              <Check className="size-4" aria-hidden="true" />
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => setShowClearAllConfirm(true)}
              className="inline-flex min-h-[40px] items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Clear read
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Bell className="size-10 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-gray-600">{loading ? "Loading notifications..." : "No notifications to display"}</p>
          </div>
        ) : (
          filteredNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`bg-white rounded-xl border p-4 transition-colors ${
                notification.read ? "border-gray-200" : `${getTypeBg(notification.type)} border-emerald-200`
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div className={`p-2 rounded-lg shrink-0 ${notification.read ? "bg-gray-100" : "bg-white"}`}>{getTypeIcon(notification.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-1">
                    <h2 className="text-sm font-semibold text-gray-900">
                      {notification.title}
                      {!notification.read && <span className="ml-2 inline-block size-2 bg-emerald-600 rounded-full" aria-label="Unread" />}
                    </h2>
                    <div className="text-xs text-gray-500 whitespace-nowrap">{relativeTime(notification.created_at)}</div>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{notification.message}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                      {notification.category}
                    </span>
                    {!notification.read && (
                      <button
                        type="button"
                        onClick={() => void markNotificationRead(notification.id)}
                        className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        Mark as read
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(notification.id)}
                      className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800 hover:underline ml-auto"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => confirmDelete()}
        title="Delete Notification"
        message="Are you sure you want to delete this notification?"
        variant="danger"
        confirmText="Delete"
      />
      <ConfirmModal
        isOpen={showClearAllConfirm}
        onClose={() => setShowClearAllConfirm(false)}
        onConfirm={() => confirmClearAll()}
        title="Clear All Read Notifications"
        message="Are you sure you want to clear all read notifications?"
        variant="warning"
        confirmText="Clear Read"
      />
    </div>
  );
}
