import { AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { OverflowLogEntry } from "../../hooks/useOverflowDispatch";

interface OverflowEventLogProps {
  entries: OverflowLogEntry[];
  loading: boolean;
}

const TYPE_CONFIG: Record<OverflowLogEntry["type"], { icon: typeof Clock; color: string; dotColor: string }> = {
  signal: { icon: AlertTriangle, color: "text-red-600", dotColor: "bg-red-500" },
  dispatch: { icon: ArrowRightLeft, color: "text-blue-600", dotColor: "bg-blue-500" },
  accept: { icon: CheckCircle2, color: "text-green-600", dotColor: "bg-green-500" },
  decline: { icon: XCircle, color: "text-amber-600", dotColor: "bg-amber-500" },
  complete: { icon: CheckCircle2, color: "text-emerald-600", dotColor: "bg-emerald-500" },
};

export default function OverflowEventLog({ entries, loading }: OverflowEventLogProps) {
  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-500">
        <Clock className="size-8 mb-2 text-gray-300" />
        <p className="text-sm">No overflow events today.</p>
      </div>
    );
  }

  return (
    <div className="max-h-[500px] overflow-y-auto">
      <div className="relative pl-6">
        {/* Timeline line */}
        <div className="absolute left-2.5 top-2 bottom-2 w-px bg-gray-200" />

        {entries.map((entry) => {
          const config = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.dispatch;
          const Icon = config.icon;

          return (
            <div key={entry.id} className="relative flex items-start gap-3 py-2.5">
              {/* Timeline dot */}
              <div className={`absolute left-[-14px] mt-1.5 size-2.5 rounded-full ring-2 ring-white ${config.dotColor}`} />

              <Icon className={`size-4 mt-0.5 shrink-0 ${config.color}`} />
              <p className="text-sm text-gray-700 leading-snug">{entry.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
