import { useState } from "react";
import { Eye, EyeOff, ListFilter, Plus } from "lucide-react";
import type { ReferenceRecord, ReferenceTableName } from "../../hooks/useLiveData";

interface ReferenceListsTabProps {
  allReportCategories: ReferenceRecord[];
  allMaintenanceTypes: ReferenceRecord[];
  allBinTypes: ReferenceRecord[];
  onCreateItem: (table: ReferenceTableName, name: string) => Promise<void>;
  onUpdateItem: (
    table: ReferenceTableName,
    id: string,
    payload: Partial<Pick<ReferenceRecord, "name" | "is_active" | "sort_order">>,
  ) => Promise<void>;
}

interface ReferenceSectionConfig {
  table: ReferenceTableName;
  title: string;
  description: string;
  placeholder: string;
  items: ReferenceRecord[];
}

/** Manages operational dropdown reference tables stored in Supabase. */
export default function ReferenceListsTab({
  allReportCategories,
  allMaintenanceTypes,
  allBinTypes,
  onCreateItem,
  onUpdateItem,
}: ReferenceListsTabProps) {
  const [newNames, setNewNames] = useState<Record<ReferenceTableName, string>>({
    report_categories: "",
    maintenance_types: "",
    bin_types: "",
  });
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<Record<ReferenceTableName, string | null>>({
    report_categories: null,
    maintenance_types: null,
    bin_types: null,
  });

  const sections: ReferenceSectionConfig[] = [
    {
      table: "report_categories",
      title: "Incident & Issue Categories",
      description: "Populates the category options used in Reports & Issues and mobile driver issue submissions.",
      placeholder: "Add category (e.g. Illegal Dumping)",
      items: allReportCategories,
    },
    {
      table: "maintenance_types",
      title: "Fleet Maintenance Types",
      description: "Populates work-order categories in Live Monitoring → Fleet Maintenance logs.",
      placeholder: "Add type (e.g. Brake Inspection)",
      items: allMaintenanceTypes,
    },
    {
      table: "bin_types",
      title: "Waste Container & Bin Types",
      description: "Populates container type selections in Areas & Bins asset management.",
      placeholder: "Add bin type (e.g. 660L Wheelie Bin)",
      items: allBinTypes,
    },
  ];

  const handleAdd = async (table: ReferenceTableName) => {
    const trimmed = newNames[table].trim();
    if (!trimmed) {
      setSectionError((prev) => ({ ...prev, [table]: "Enter a label before adding." }));
      return;
    }

    setBusyKey(`add:${table}`);
    setSectionError((prev) => ({ ...prev, [table]: null }));
    try {
      await onCreateItem(table, trimmed);
      setNewNames((prev) => ({ ...prev, [table]: "" }));
    } catch (err: any) {
      setSectionError((prev) => ({ ...prev, [table]: err?.message ?? "Unable to add option." }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRenameBlur = async (table: ReferenceTableName, item: ReferenceRecord, rawValue: string) => {
    const trimmed = rawValue.trim();
    const rowKey = `${table}:${item.id}`;
    setDraftLabels((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });

    if (!trimmed || trimmed === item.name) return;

    setBusyKey(`edit:${rowKey}`);
    setSectionError((prev) => ({ ...prev, [table]: null }));
    try {
      await onUpdateItem(table, item.id, { name: trimmed });
    } catch (err: any) {
      setSectionError((prev) => ({ ...prev, [table]: err?.message ?? "Unable to rename option." }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleActive = async (table: ReferenceTableName, item: ReferenceRecord) => {
    const rowKey = `${table}:${item.id}`;
    setBusyKey(`toggle:${rowKey}`);
    setSectionError((prev) => ({ ...prev, [table]: null }));
    try {
      await onUpdateItem(table, item.id, { is_active: item.is_active === false });
    } catch (err: any) {
      setSectionError((prev) => ({ ...prev, [table]: err?.message ?? "Unable to update visibility." }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <ListFilter className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Operational Lookup Lists</h2>
            <p className="mt-1 text-sm text-gray-600">
              Lookup changes save directly to Supabase so active dropdowns update across modules without losing
              historical records. Toggle visibility instead of deleting items in use.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {sections.map((section) => {
          const inputId = `ref-add-${section.table}`;
          const hintId = `ref-hint-${section.table}`;
          const activeCount = section.items.filter((item) => item.is_active !== false).length;

          return (
            <section
              key={section.table}
              aria-labelledby={`heading-${section.table}`}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 id={`heading-${section.table}`} className="text-base font-semibold text-gray-900">
                    {section.title}
                  </h3>
                  <p id={hintId} className="mt-1 text-xs leading-relaxed text-gray-600">
                    {section.description}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                  {activeCount}/{section.items.length} active
                </span>
              </div>

              {sectionError[section.table] && (
                <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {sectionError[section.table]}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <label htmlFor={inputId} className="sr-only">
                  {section.title} new entry
                </label>
                <input
                  id={inputId}
                  type="text"
                  value={newNames[section.table]}
                  aria-describedby={hintId}
                  placeholder={section.placeholder}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewNames((prev) => ({ ...prev, [section.table]: val }));
                    if (sectionError[section.table]) {
                      setSectionError((prev) => ({ ...prev, [section.table]: null }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAdd(section.table);
                    }
                  }}
                  className="input-field min-w-0 flex-1"
                />
                <button
                  type="button"
                  disabled={busyKey === `add:${section.table}`}
                  onClick={() => void handleAdd(section.table)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </div>

              <div className="mt-4 flex-1 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {section.items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-gray-500">No entries configured.</p>
                ) : (
                  section.items.map((item) => {
                    const rowKey = `${section.table}:${item.id}`;
                    const currentVal = draftLabels[rowKey] ?? item.name;
                    const isActive = item.is_active !== false;
                    const isRowBusy = busyKey === `edit:${rowKey}` || busyKey === `toggle:${rowKey}`;

                    return (
                      <div key={item.id} className="flex items-center gap-2 px-2.5 py-2">
                        <input
                          type="text"
                          aria-label={`${section.title} option ${item.name}`}
                          value={currentVal}
                          disabled={isRowBusy}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraftLabels((prev) => ({ ...prev, [rowKey]: val }));
                          }}
                          onBlur={(e) => void handleRenameBlur(section.table, item, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none ${
                            isActive ? "text-gray-900" : "text-gray-400 line-through"
                          }`}
                        />
                        <button
                          type="button"
                          disabled={isRowBusy}
                          aria-pressed={isActive}
                          aria-label={`${isActive ? "Hide" : "Activate"} ${item.name}`}
                          onClick={() => void handleToggleActive(section.table, item)}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {isActive ? (
                            <>
                              <Eye className="size-3.5" aria-hidden="true" />
                              <span>Active</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="size-3.5" aria-hidden="true" />
                              <span>Hidden</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
