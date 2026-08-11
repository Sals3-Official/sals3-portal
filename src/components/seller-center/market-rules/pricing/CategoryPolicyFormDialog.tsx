'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  saveCategoryPolicyAction,
  searchSals3CategoriesAction,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Sals3CategoryRow } from '@/lib/db/schema';
import type { CategoryPolicyWithCategory } from '@/modules/pricing/repository';

type CategoryPolicyFormDialogProps = {
  mode: 'create' | 'edit';
  /** Present when, and only when, `mode === 'edit'`. */
  existing?: CategoryPolicyWithCategory;
};

/**
 * "Add category policy" / "Edit" — one Sals3 category at a time, deliberately.
 * No "set all categories to X%" control exists here, per the turnover's own
 * instruction: category policy is a normal operational default, not a blunt
 * global markup.
 */
export default function CategoryPolicyFormDialog({
  mode,
  existing,
}: CategoryPolicyFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Sals3CategoryRow[]>([]);
  const [selectedCode, setSelectedCode] = useState(
    existing?.categoryCode ?? '',
  );
  const [marginPercent, setMarginPercent] = useState(
    existing === undefined
      ? ''
      : (Number(existing.targetMarginRate) * 100).toString(),
  );
  const [roundingRule, setRoundingRule] = useState<'NONE' | 'NEAREST_0_99'>(
    existing?.roundingRule ?? 'NONE',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  async function handleSearch(value: string) {
    setQuery(value);

    if (value.trim() === '') {
      setResults([]);
      return;
    }

    const result = await searchSals3CategoriesAction(value);
    if (result.ok) setResults(result.data);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const marginRate = (Number(marginPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveCategoryPolicyAction({
        categoryCode: selectedCode,
        targetMarginRate: marginRate,
        roundingRule,
        reason,
      });

      if (!result.ok) {
        setError(
          result.reason === 'not_found'
            ? 'That category could not be found. Search and select it again.'
            : 'Check the highlighted fields and try again.',
        );
        return;
      }

      toast.success(
        mode === 'edit'
          ? 'Category policy updated.'
          : 'Category policy created.',
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={mode === 'edit' ? 'outline' : 'default'}
            size="sm"
          >
            {mode === 'edit' ? 'Edit' : 'Add category policy'}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit category policy' : 'Add category policy'}
          </DialogTitle>
          <DialogDescription>
            Sets the target margin for one Sals3 category. This becomes price
            guidance for every product mapped to it, unless a product or variant
            override applies.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error === null ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-category`}>Category</Label>
            {mode === 'edit' && existing !== undefined ? (
              <p className="text-sm">
                {existing.categoryPath}{' '}
                <span className="text-muted-foreground">
                  ({existing.categoryCode})
                </span>
              </p>
            ) : (
              <>
                <Input
                  id={`${fieldId}-category`}
                  placeholder="Search by name or code…"
                  value={query}
                  onChange={(event) => handleSearch(event.target.value)}
                  autoComplete="off"
                />
                {results.length > 0 ? (
                  <Select
                    value={selectedCode}
                    onValueChange={(value) => setSelectedCode(value ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a matching category" />
                    </SelectTrigger>
                    <SelectContent>
                      {results.map((category) => (
                        <SelectItem key={category.code} value={category.code}>
                          {category.path} ({category.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-margin`}>Target margin (%)</Label>
            <Input
              id={`${fieldId}-margin`}
              type="number"
              min="0.01"
              max="99.99"
              step="0.01"
              inputMode="decimal"
              required
              value={marginPercent}
              onChange={(event) => setMarginPercent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-rounding`}>Rounding</Label>
            <Select
              value={roundingRule}
              onValueChange={(value) =>
                setRoundingRule(value as 'NONE' | 'NEAREST_0_99')
              }
            >
              <SelectTrigger id={`${fieldId}-rounding`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">
                  None — exact computed price
                </SelectItem>
                <SelectItem value="NEAREST_0_99">Nearest .99</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-reason`}>Reason</Label>
            <Textarea
              id={`${fieldId}-reason`}
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this margin for this category?"
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending || selectedCode === ''}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
