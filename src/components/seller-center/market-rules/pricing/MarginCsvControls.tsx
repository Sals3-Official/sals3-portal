'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this control's own local state. */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
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
 * Bulk margin editing over a spreadsheet.
 *
 * ## One file, both jobs
 *
 * Export writes every category with whatever margin it already carries.
 * Emptied of values that same file is the template, so there is no second
 * format to keep in step and no way for the two to drift. A seller who has
 * set nothing downloads a blank sheet; a seller who has set thirty
 * downloads their thirty, edits in place, and uploads the same shape back.
 *
 * ## Export is built here, not fetched
 *
 * The tree already holds every row it can offer, so the download costs no
 * round trip and cannot disagree with what is on screen. It writes the
 * margin set ON each category, never the inherited one — an export that
 * baked in inheritance would, on re-import, turn every inherited rate into
 * an explicit policy and quietly destroy the inheritance the screen exists
 * to express.
 */
export default function MarginCsvControls({
  nodes,
  canManage,
}: MarginCsvControlsProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canApply =
    csv !== null && reason.trim().length >= MIN_REASON_CHARS && !isPending;

  function handleExport() {
    const csvText = buildMarginCsv(
      nodes.map((node) => ({
        code: node.code,
        path: node.path,
        ownMarginRate: node.policy?.targetMarginRate ?? null,
        ownRoundingRule: node.policy?.roundingRule ?? null,
      })),
    );

    // `text/csv` with a BOM so Excel opens a UTF-8 path like
    // "Food, Beverages & Tobacco" without mangling it.
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

      toast.success(
        `${written} changed, ${cleared} cleared, ${unchanged} already correct.`,
      );
      setIsOpen(false);
      setCsv(null);
      setFileName(null);
      setReason('');
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleExport}>
        <Download aria-hidden="true" className="size-3.5" />
        Export CSV
      </Button>

      {canManage ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(true)}
          >
            <Upload aria-hidden="true" className="size-3.5" />
            Import CSV
          </Button>

          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) {
                setRowErrors([]);
                setError(null);
              }
            }}
          >
            <DialogContent
              className="sm:max-w-2xl"
              overlayClassName="bg-foreground/15 supports-backdrop-filter:backdrop-blur-md"
            >
              <DialogHeader>
                <DialogTitle>Import category margins</DialogTitle>
                <DialogDescription>
                  Export the file first. Change the margin_percent column. Then
                  upload the same file here. An empty cell removes the margin
                  from that category.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="margin-csv-file">File</Label>
                  <Input
                    id="margin-csv-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChosen}
                  />
                  {fileName === null ? null : (
                    <span className="text-xs text-ink-faint">{fileName}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="margin-csv-reason">Reason for change</Label>
                  <Input
                    id="margin-csv-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why did you change these margins?"
                  />
                  <span className="text-xs text-ink-faint">
                    {`Use ${MIN_REASON_CHARS} characters or more. You have ${reason.trim().length}. The system records this reason against every row in the file.`}
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
                      The system did not change anything. Correct these lines,
                      then upload the file again.
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

                <div className="flex items-center justify-end gap-2">
                  <DialogClose
                    render={
                      <Button type="button" variant="outline">
                        Cancel
                      </Button>
                    }
                  />
                  <Button
                    type="button"
                    disabled={!canApply}
                    onClick={handleApply}
                  >
                    {isPending ? 'Applying…' : 'Apply file'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
