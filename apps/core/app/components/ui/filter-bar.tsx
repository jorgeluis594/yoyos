import type { ReactNode } from "react";

export function FilterBar({ label, control, action }: { label: string; control?: ReactNode; action: ReactNode }) {
  return <div role="group" aria-label={label} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border bg-card p-3 sm:items-center">
    {control && <div className="min-w-0 flex-1">{control}</div>}
    <div className="ml-auto">{action}</div>
  </div>;
}
