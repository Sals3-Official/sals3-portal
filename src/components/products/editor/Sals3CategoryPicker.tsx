'use client';

import { ChevronRight, Pencil } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type Sals3CategoryOption = { code: string; path: string };

type Sals3CategoryPickerProps = {
  options: Sals3CategoryOption[];
  /** The currently resolved category, if any — from the read-model, never invented client-side. */
  currentPath: string | null;
  onSave: (
    code: string,
    reason: string,
  ) => Promise<
    { ok: true; categoryPath: string } | { ok: false; message: string }
  >;
};

const MAX_RESULTS = 20;
const PATH_SEPARATOR = ' > ';

type TreeNode = {
  name: string;
  /** Set only on the node a full path actually ends at — every option is a leaf, so this is never set on a node that also has children. */
  option: Sals3CategoryOption | null;
  children: Map<string, TreeNode>;
};

function buildTree(options: Sals3CategoryOption[]): TreeNode {
  const root: TreeNode = { name: '', option: null, children: new Map() };

  options.forEach((option) => {
    const leaf = option.path.split(PATH_SEPARATOR).reduce((node, segment) => {
      const existing = node.children.get(segment);
      if (existing !== undefined) return existing;

      const created: TreeNode = {
        name: segment,
        option: null,
        children: new Map(),
      };
      node.children.set(segment, created);
      return created;
    }, root);

    leaf.option = option;
  });

  return root;
}

function nodeAt(root: TreeNode, stack: string[]): TreeNode {
  return stack.reduce(
    (node, segment) => node.children.get(segment) ?? node,
    root,
  );
}

/**
 * Search-first, not a flat dropdown: 5,595 rows across 21 departments and up
 * to 5 levels each makes a plain `<select>` unusable. The dialog opens
 * straight into a department browser built from the same denormalized
 * `path` strings (e.g. "Apparel & Accessories > Clothing > Outerwear >
 * Coats & Jackets"), split on " > " into a tree — no typing required to see
 * anything. A search box inside the same dialog is a shortcut for a seller
 * who already knows the name, filtering the whole tree by substring on
 * `path` at any depth.
 *
 * A picked category is not saved until "Save category" is pressed with a
 * reason — the reason is the seller's own record of why, not a governance
 * review artifact: this changes only the one product open in this editor
 * (owner decision 2026-08-15 — see `decideProductSals3Category`'s doc
 * comment), never another product or another seller's catalogue.
 *
 * Once a category is already resolved, this renders a compact, read-only
 * looking value next to a single icon button — an editable-looking input
 * sitting next to an already-decided value read as "this still needs
 * picking" even though nothing was wrong. The dialog only reopens once that
 * button is pressed.
 */
export default function Sals3CategoryPicker({
  options,
  currentPath,
  onSave,
}: Sals3CategoryPickerProps) {
  const tree = useMemo(() => buildTree(options), [options]);

  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Sals3CategoryOption | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const effectivePath = savedPath ?? currentPath;

  const resetDialogState = useCallback(() => {
    setStack([]);
    setQuery('');
    setSelected(null);
    setReason('');
    setStatus({ state: 'idle' });
  }, []);

  const openDialog = useCallback(() => {
    resetDialogState();
    setOpen(true);
  }, [resetDialogState]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) resetDialogState();
    },
    [resetDialogState],
  );

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    if (trimmed === '') return [];

    return options
      .filter((option) => option.path.toLowerCase().includes(trimmed))
      .slice(0, MAX_RESULTS);
  }, [options, query]);

  const currentNode = useMemo(() => nodeAt(tree, stack), [tree, stack]);
  const currentEntries = useMemo(
    () =>
      [...currentNode.children.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [currentNode],
  );

  const canSave = selected !== null && reason.trim().length >= 8;

  const handleSave = useCallback(async () => {
    if (selected === null) return;

    setStatus({ state: 'saving' });

    const result = await onSave(selected.code, reason.trim());

    if (result.ok) {
      setSavedPath(result.categoryPath);
      setOpen(false);
      resetDialogState();
    } else {
      setStatus({ state: 'error', message: result.message });
    }
  }, [onSave, reason, resetDialogState, selected]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="editor-sals3-category-v1">Category</Label>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-sm">
        <span className="truncate">
          {effectivePath ?? (
            <span className="text-muted-foreground">Not set</span>
          )}
        </span>
        <button
          id="editor-sals3-category-v1"
          type="button"
          aria-label={
            effectivePath === null ? 'Choose category' : 'Change category'
          }
          className="flex shrink-0 items-center text-primary"
          onClick={openDialog}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose category</DialogTitle>
          </DialogHeader>

          {selected !== null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-input px-2.5 py-1.5 text-sm">
                <span>{selected.path}</span>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setSelected(null)}
                >
                  Change
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="editor-sals3-category-reason">Reason</Label>
                <Input
                  id="editor-sals3-category-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why this category (at least 8 characters)"
                  aria-describedby="editor-sals3-category-reason-help"
                />
                {reason.trim().length >= 8 ? null : (
                  <p
                    id="editor-sals3-category-reason-help"
                    className="text-xs text-muted-foreground"
                  >
                    {8 - reason.trim().length} more character
                    {8 - reason.trim().length === 1 ? '' : 's'} needed.
                  </p>
                )}
              </div>
              {status.state === 'error' ? (
                <p role="alert" className="text-xs font-medium text-red-600">
                  {status.message}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="self-start"
                disabled={!canSave || status.state === 'saving'}
                onClick={handleSave}
              >
                {status.state === 'saving' ? 'Saving…' : 'Save category'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                type="search"
                placeholder="Search the Sals3 v1 taxonomy, e.g. Jackets"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />

              {query.trim() === '' ? (
                <>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <button
                      type="button"
                      className={
                        stack.length === 0
                          ? 'font-medium text-foreground'
                          : 'hover:underline'
                      }
                      onClick={() => setStack([])}
                    >
                      All departments
                    </button>
                    {stack.map((segment, index) => (
                      <span key={segment} className="flex items-center gap-1">
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3 shrink-0"
                        />
                        <button
                          type="button"
                          className={
                            index === stack.length - 1
                              ? 'font-medium text-foreground'
                              : 'hover:underline'
                          }
                          onClick={() => setStack(stack.slice(0, index + 1))}
                        >
                          {segment}
                        </button>
                      </span>
                    ))}
                  </div>

                  <ul className="max-h-72 overflow-y-auto rounded-lg border border-border">
                    {currentEntries.length === 0 ? (
                      <li className="px-2.5 py-2 text-sm text-muted-foreground">
                        Nothing under this department.
                      </li>
                    ) : (
                      currentEntries.map((entry) => {
                        const isBranch = entry.children.size > 0;
                        return (
                          <li key={entry.name}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                if (isBranch) {
                                  setStack([...stack, entry.name]);
                                } else if (entry.option !== null) {
                                  setSelected(entry.option);
                                }
                              }}
                            >
                              {entry.name}
                              {isBranch ? (
                                <ChevronRight
                                  aria-hidden="true"
                                  className="size-3.5 shrink-0 text-muted-foreground"
                                />
                              ) : null}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </>
              ) : (
                <ul className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  {matches.length === 0 ? (
                    <li className="px-2.5 py-2 text-sm text-muted-foreground">
                      No category matches &quot;{query}&quot;.
                    </li>
                  ) : (
                    matches.map((option) => (
                      <li key={option.code}>
                        <button
                          type="button"
                          className="block w-full px-2.5 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setSelected(option);
                            setQuery('');
                          }}
                        >
                          {option.path}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
