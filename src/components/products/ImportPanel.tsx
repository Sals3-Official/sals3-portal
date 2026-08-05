'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { previewImportAction } from '@/app/(portal)/products/import/actions';
import { CSV_COLUMNS } from '@/lib/products/csv';
import { IDLE_IMPORT } from '@/lib/products/import-state';

/**
 * CSV upload and preview. The file is checked and parsed on the server; the
 * rows shown here are a preview, and nothing is written to the catalogue.
 */
export default function ImportPanel() {
  const [state, submit, pending] = useActionState(
    previewImportAction,
    IDLE_IMPORT,
  );

  return (
    <div className="flex flex-col gap-4">
      <form
        action={submit}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="file" className="text-sm font-medium">
            Product CSV file
          </Label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="cursor-pointer rounded-lg border border-input bg-card p-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Up to 1 MB. Required columns: {CSV_COLUMNS.join(', ')}.
          </p>
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="w-fit cursor-pointer"
        >
          {pending ? 'Reading…' : 'Read the file'}
        </Button>
        <p
          aria-live="polite"
          className={`text-sm ${
            state.status === 'error'
              ? 'font-medium text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          {state.message}
        </p>
      </form>

      {state.problems.length > 0 ? (
        <ul className="rounded-lg border border-destructive/40 bg-danger-surface p-3 text-sm text-red-600">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {state.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Line</th>
                {CSV_COLUMNS.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.slice(0, 25).map((row) => (
                <tr key={row.line} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.line}
                  </td>
                  {CSV_COLUMNS.map((column) => (
                    <td key={column} className="px-3 py-2">
                      {row.values[column] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
