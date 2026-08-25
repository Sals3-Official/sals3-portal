'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this control's own local state. */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { applyMarginCsvAction } from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildMarginCsv } from '@/modules/pricing/margin-csv';
import type { CategoryMarginNodeViewModel } from './category-margin-model';

type MarginCsvControlsProps = {
  nodes: CategoryMarginNodeViewModel[];
  canManage: boolean;
};

const MIN_REASON_CHARS = 10;
const MAX_FILE_BYTES = 2_000_000;

/**
 * Bulk margin editing over a spreadsheet, behind ONE button.
 *
 * ## One button, because it is one job
 *
 * This shipped as a pair — "Export CSV" beside "Import CSV" — and the owner
 * asked for a single control. He is right, and not only on tidiness: nobody
 * uploads a file they did not first download. Two buttons presented a
 * sequence as a choice, when the download is step one of the upload rather
 * than an alternative to it. The dialog now numbers them.
 *
 * ## One file, both jobs
 *
 * Export writes every category with whatever margin it already carries.
 * Emptied of values that same file is the template, so there is no second
 * format to keep in step and no way for the two to drift.
 *
 * It writes the margin set ON each category, never the inherited one — an
 * export that baked in inheritance would, on re-import, turn every inherited
 * rate into an explicit policy and quietly destroy the inheritance the
 * screen exists to express.
 */
export default function MarginCsvControls({
  nodes,
  canManage,
}: MarginCsvControlsProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canApply =
    csv !== null && reason.trim().length >= MIN_REASON_CHARS && !isPending;

  function resetUpload() {
    setCsv(null);
    setFileName(null);
    setReason('');
    setRowErrors([]);
    setError(null);
  }

  function handleExport() {
    const csvText = buildMarginCsv(
      nodes.map((node) => ({
        code: node.code,
        path: node.path,
        ownMarginRate: node.policy?.targetMarginRate ?? null,
        ownRoundingRule: node.policy?.roundingRule ?? null,
        // The scope the row was actually read from, so the file carries its own
        // destination and cannot be imported onto a different one.
        marketCode: node.policy?.marketCode ?? null,
      })),
    );

    // A BOM so Excel opens a UTF-8 path like "Food, Beverages & Tobacco"
    // without mangling it.
    const blob = new Blob([`\ufeff${csvText}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'sals3-category-margins.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setRowErrors([]);
    setError(null);

    if (file === undefined) {
      setCsv(null);
      setFileName(null);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setCsv(null);
      setFileName(file.name);
      setError('That file is too large to be a margin sheet.');
      return;
    }

    setFileName(file.name);
    setCsv(await file.text());
  }

  function handleApply() {
    if (csv === null) return;

    setError(null);
    setRowErrors([]);

    startTransition(async () => {
      const result = await applyMarginCsvAction({ csv, reason });

      if (!result.ok) {
        if ('rowErrors' in result && result.rowErrors !== undefined) {
          setRowErrors(result.rowErrors);
          return;
        }
        setError(
          'fieldErrors' in result && result.fieldErrors?.reason !== undefined
            ? result.fieldErrors.reason
            : 'The system could not apply this file. Try again.',
        );
        return;
      }

      const { written, cleared, unchanged } = result.data;

      /**
       * Refresh BEFORE closing.
       *
       * The reverse order is what left a saved margin stale until a manual
       * reload: closing tears down the surface this transition is running
       * on, and a refresh dispatched after it is discarded. The same defect
       * `CategoryMarginDialog` had, reintroduced here because this dialog
       * was written from the same shape.
       */
      router.refresh();

      toast.success(
        `${written} changed, ${cleared} cleared, ${unchanged} already correct.`,
      );
      setIsOpen(false);
      resetUpload();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <FileSpreadsheet aria-hidden="true" className="size-3.5" />
        Import / export
      </Button>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetUpload();
        }}
      >
        <DialogContent
          className="sm:max-w-2xl"
          overlayClassName="bg-foreground/15 supports-backdrop-filter:backdrop-blur-md"
        >
          <DialogHeader>
            <DialogTitle>Category margins as a spreadsheet</DialogTitle>
            <DialogDescription>
              Download the file. Change the margin_percent column. Then upload
              the same file.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">1. Download the file</h3>
              <p className="text-xs text-ink-faint">
                The file contains every category and the margin you already set.
                A category with no margin has an empty cell. This file is also
                the template.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleExport}
              >
                <Download aria-hidden="true" className="size-3.5" />
                Download CSV
              </Button>
            </section>

            {canManage ? (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">2. Upload the file</h3>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="margin-csv-file">File</Label>
                  <Input
                    id="margin-csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChosen}
                  />
                  {fileName === null ? null : (
                    <span className="text-xs text-ink-faint">{fileName}</span>
                  )}
                  <span className="text-xs text-ink-faint">
                    An empty margin cell removes the margin from that category.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="margin-csv-reason">Reason for change</Label>
                  <Input
                    id="margin-csv-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why did you change these margins?"
                    aria-describedby="margin-csv-reason-hint"
                  />
                  <span
                    id="margin-csv-reason-hint"
                    className="text-xs text-ink-faint"
                  >
                    {`Use ${MIN_REASON_CHARS} characters or more. You have ${reason.trim().length}. The system records this reason against every row.`}
                  </span>
                </div>

                {error === null ? null : (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                {rowErrors.length === 0 ? null : (
                  <div
                    role="alert"
                    className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-destructive">
                      The system changed nothing. Correct these lines. Then
                      upload the file again.
                    </p>
                    <ul className="max-h-48 list-disc overflow-y-auto pl-4 text-xs text-destructive">
                      {rowErrors.slice(0, 50).map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                    {rowErrors.length > 50 ? (
                      <span className="text-xs text-destructive">
                        {`… and ${rowErrors.length - 50} more.`}
                      </span>
                    ) : null}
                  </div>
                )}

                <p className="text-xs text-ink-faint">
                  The system applies the whole file or none of it. If one line
                  is wrong, nothing changes.
                </p>
              </section>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Close
                  </Button>
                }
              />
              {canManage ? (
                <Button
                  type="button"
                  disabled={!canApply}
                  onClick={handleApply}
                >
                  {isPending ? 'Applying…' : 'Apply file'}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
