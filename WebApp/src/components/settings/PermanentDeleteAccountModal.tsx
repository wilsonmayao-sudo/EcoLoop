import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import {
  formatAccountRoleLabel,
  formatAccountStatusLabel,
  accountStatusBadgeClass,
  type AdminUserProfileRow,
} from "../../utils/userProfiles";

interface PermanentDeleteAccountModalProps {
  account: AdminUserProfileRow | null;
  onClose: () => void;
  onConfirmDelete: (account: AdminUserProfileRow) => Promise<void>;
}

/**
 * Multi-step permanent account deletion confirmation dialog.
 * Displays full target account identity, explains irreversibility and data retention,
 * and requires an explicit typed confirmation + acknowledgment checkbox before deletion.
 */
export default function PermanentDeleteAccountModal({
  account,
  onClose,
  onConfirmDelete,
}: PermanentDeleteAccountModalProps) {
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  const isOpen = Boolean(account);
  const expectedPhrase = account?.email?.trim() ? account.email.trim() : "DELETE";
  const confirmationMatches =
    typedConfirmation.trim().toLowerCase() === expectedPhrase.toLowerCase();
  const canConfirm = isOpen && acknowledged && confirmationMatches && !submitting;

  useEffect(() => {
    if (isOpen) {
      setTypedConfirmation("");
      setAcknowledged(false);
      setSubmitting(false);
      setErrorMessage(null);
      requestAnimationFrame(() => cancelBtnRef.current?.focus());
    }
  }, [isOpen, account?.auth_user_id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!account) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirmDelete(account);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Failed to permanently delete this account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[410] flex items-center justify-center bg-black/55 p-4 overscroll-contain"
      onClick={() => {
        if (!submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-modal-title"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="size-5 text-red-700" aria-hidden="true" />
            </div>
            <div>
              <h2 id="delete-account-modal-title" className="text-base font-semibold text-gray-900">
                Permanently Delete Account
              </h2>
              <p className="text-xs text-gray-500">Irreversible administrative action</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex size-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Target Account Verification Card */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Account Scheduled for Deletion
            </p>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {account.full_name || "Unnamed User"}
                </p>
                <p className="truncate text-xs text-gray-600">{account.email || "No email on file"}</p>
                <p className="mt-1 font-mono text-[11px] text-gray-500">ID: {account.auth_user_id}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-gray-200/80 px-2 py-0.5 text-xs font-medium text-gray-800">
                  {formatAccountRoleLabel(account.role)}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${accountStatusBadgeClass(account.status)}`}>
                  {formatAccountStatusLabel(account.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Permanence Warning */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-900">
            <p className="font-semibold text-red-950">This action is permanent and cannot be undone.</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Authentication credentials and active sessions will be permanently removed so this user cannot log back in.</li>
              <li>Their user profile, linked driver record, and personal notifications will be deleted.</li>
              <li>Assigned vehicles and open routes will be safely detached; completed routes, deliveries, reports, and audit logs remain preserved.</li>
            </ul>
          </div>

          {/* Step 1: Checkbox confirmation */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-xs text-gray-800 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 size-4 rounded border-gray-300 text-red-600 focus:ring-red-600"
            />
            <span>
              I understand that deleting <strong>{account.full_name || account.email || "this account"}</strong> is permanent and prefer temporary suspension if access may be restored later.
            </span>
          </label>

          {/* Step 2: Explicit phrase confirmation */}
          <div>
            <label htmlFor="confirm-delete-account-input" className="block text-xs font-medium text-gray-700">
              Type <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono font-semibold text-gray-900">{expectedPhrase}</span> to confirm deletion
            </label>
            <input
              id="confirm-delete-account-input"
              type="text"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              disabled={submitting}
              autoComplete="off"
              placeholder={expectedPhrase}
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:bg-gray-50"
            />
          </div>

          {errorMessage && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2.5 border-t border-gray-200 pt-3 sm:flex-row">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[42px] flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>{submitting ? "Deleting Account…" : "Permanently Delete Account"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
