import { useMemo, useState } from "react";
import { Bell, Check, Trash2, AlertCircle, Info, CheckCircle, X } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import { formatDateOnly, relativeTime, useLiveData } from "../hooks/useLiveData";

type NotificationFilter = "all" | "unread" | "route" | "bin" | "truck" | "report" | "system";

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
        if (filter === "all") return true;
        if (filter === "unread") return !notification.read;
        if (filter === "truck") {
          return (
            notification.category === "truck" ||
            (notification.category === "system" && notification.source_table === "vehicle_monitoring")
          );
        }
        return notification.category === filter;
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

  const filters: NotificationFilter[] = ["all", "unread", "route", "bin", "truck", "report", "system"];

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Notifications</h2>
            <p className="text-gray-600">Naga City Waste Collection Management</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-900">Today</div>
            <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Total</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : notifications.length}</div>
            <div className="text-blue-500 text-sm mt-1">All notifications</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Unread</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : unreadCount}</div>
            <div className="text-amber-500 text-sm mt-1">Needs attention</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Critical</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : notifications.filter((notification) => notification.type === "error").length}</div>
            <div className="text-red-500 text-sm mt-1">High priority</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Today</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : todayCount}</div>
            <div className="text-green-500 text-sm mt-1">Recent updates</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
                    filter === item ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {item === "unread" ? `Unread (${unreadCount})` : item}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void markAllNotificationsRead()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <Check className="size-4" />
                Mark all read
              </button>
              <button
                onClick={() => setShowClearAllConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                <Trash2 className="size-4" />
                Clear read
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {filteredNotifications.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Bell className="size-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">{loading ? "Loading notifications..." : "No notifications to display"}</p>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`bg-white rounded-lg shadow-sm border p-4 transition-all hover:shadow-md ${
                  notification.read ? "border-gray-200" : `${getTypeBg(notification.type)} border-2`
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${notification.read ? "bg-gray-100" : ""}`}>{getTypeIcon(notification.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-1">
                      <h3 className="text-gray-900">
                        {notification.title}
                        {!notification.read && <span className="ml-2 inline-block w-2 h-2 bg-emerald-600 rounded-full" />}
                      </h3>
                      <div className="text-xs text-gray-500 whitespace-nowrap">{relativeTime(notification.created_at)}</div>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{notification.message}</p>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 capitalize">
                        {notification.category}
                      </span>
                      {!notification.read && (
                        <button
                          onClick={() => void markNotificationRead(notification.id)}
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          <Check className="size-3" />
                          Mark as read
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(notification.id)}
                        className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 ml-auto"
                      >
                        <X className="size-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => confirmDelete()}
        title="Delete Notification"
        message="Are you sure you want to delete this notification?"
      />
      <ConfirmModal
        isOpen={showClearAllConfirm}
        onClose={() => setShowClearAllConfirm(false)}
        onConfirm={() => confirmClearAll()}
        title="Clear All Read Notifications"
        message="Are you sure you want to clear all read notifications?"
      />
    </div>
  );
}
