'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  recordManualStockCheck,
  type RecordStockAttestationResult,
} from '@/app/(portal)/products/actions';
import type { StockReviewState } from '@/lib/db/schema';

type ManualStockCheckFormProps = {
  candidateId: string;
  /** The stock-review version this drawer rendered; the server compares it. */
  expectedVersion: number;
  currentState: StockReviewState;
};

const STATE_OPTIONS: { value: StockReviewState; label: string }[] = [
  { value: 'MANUALLY_IN_STOCK', label: 'I saw stock available' },
  { value: 'MANUALLY_NO_INVENTORY', label: 'I saw no inventory' },
  { value: 'MANUALLY_COULD_NOT_VERIFY', label: 'I could not verify it' },
];

const FAILURE_COPY: Record<
  Extract<RecordStockAttestationResult, { ok: false }>['reason'],
  string
> = {
  invalid_input: 'Check the values and try again.',
  denied: 'You do not have permission to record a stock check.',
  rate_limited: 'Too many checks recorded just now. Try again shortly.',
  not_found_or_stale:
    'This product’s stock review changed since the page loaded. Reload and record again.',
  failed: 'The check could not be saved. Try again.',
};

/**
 * Records a manual CJ/MyCJ inspection.
 *
 * This form deliberately does NOT offer a "check inventory through the CJ
 * API" action - the approved interim decision is manual website inspection
 * only, and nothing here makes a supplier request. It is an attestation: a
 * named person stating what they saw and when.
 *
 * `expectedVersion` is submitted with the form so a duplicate click or a
 * second staff member who recorded a check since this drawer opened is
 * rejected by the server rather than silently overwriting the newer
 * observation.
 */
export default function ManualStockCheckForm({
  candidateId,
  expectedVersion,
  currentState,
}: ManualStockCheckFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<StockReviewState>(
    currentState === 'STOCK_NOT_CHECKED' ? 'MANUALLY_IN_STOCK' : currentState,
  );
  const [quantity, setQuantity] = useState('');
  const [origin, setOrigin] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const disabled = pending || submitting;

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);

    try {
      const result = await recordManualStockCheck({
        candidateId,
        state: state as
          | 'MANUALLY_IN_STOCK'
          | 'MANUALLY_NO_INVENTORY'
          | 'MANUALLY_COULD_NOT_VERIFY',
        expectedVersion,
        observedQuantity: quantity.trim() === '' ? null : quantity.trim(),
        observedOrigin: origin.trim() === '' ? null : origin.trim(),
        note: note.trim() === '' ? null : note.trim(),
      });

      if (result.ok) {
        setMessage('Recorded.');
        startTransition(() => router.refresh());
        return;
      }

      setMessage(FAILURE_COPY[result.reason]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();

        if (disabled) return;

        submit().catch(() => setMessage(FAILURE_COPY.failed));
      }}
    >
      <p className="text-xs text-ink-muted">
        Record what you saw on CJ or MyCJ. This is a staff attestation, not CJ
        API-verified evidence, and saving it makes no supplier request.
      </p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-ink-muted">
          What did you find?
        </legend>
        {STATE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-sm"
            htmlFor={`stock-state-${option.value}`}
          >
            <input
              id={`stock-state-${option.value}`}
              type="radio"
              name="stock-state"
              value={option.value}
              checked={state === option.value}
              onChange={() => setState(option.value)}
              disabled={disabled}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="observed-quantity" className="text-xs">
            Observed quantity (optional)
          </Label>
          <Input
            id="observed-quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={disabled}
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="observed-origin" className="text-xs">
            Observed origin (optional)
          </Label>
          <Input
            id="observed-origin"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="e.g. CN warehouse"
            disabled={disabled}
            className="h-9"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="observed-note" className="text-xs">
          Note (optional, max 500 characters)
        </Label>
        <Textarea
          id="observed-note"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          disabled={disabled}
          rows={3}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled} size="sm">
          {disabled ? 'Saving…' : 'Record stock check'}
        </Button>
        <p aria-live="polite" className="text-xs text-ink-muted">
          {message}
        </p>
      </div>
    </form>
  );
}
