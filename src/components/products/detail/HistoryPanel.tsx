import type { AuditEntry } from '@/lib/products/types';

type HistoryPanelProps = {
  entries: AuditEntry[];
};

/** Audit trail: who changed what, the old value, the new value, and when. */
export default function HistoryPanel({ entries }: HistoryPanelProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Before</th>
            <th className="px-3 py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {[...entries].reverse().map((entry) => (
            <tr key={entry.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {entry.at}
              </td>
              <td className="px-3 py-2">{entry.actor}</td>
              <td className="px-3 py-2">{entry.field}</td>
              <td className="px-3 py-2 text-muted-foreground">{entry.from}</td>
              <td className="px-3 py-2 font-medium">{entry.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
