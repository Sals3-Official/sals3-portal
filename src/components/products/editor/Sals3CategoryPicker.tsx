'use client';

import { ChevronRight, Pencil, TriangleAlert } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type Sals3CategoryOption = { code: string; path: string };

type Sals3CategoryPickerProps = {
  options: Sals3CategoryOption[];
  /** The currently resolved category, if any — from the read-model, never invented client-side. */
  currentPath: string | null;
  /**
   * Whether a seller has ever explicitly confirmed this category, as
   * opposed to it merely being the auto-mirrored CJ category the read-model
   * resolves by default. Drives the red/caution guardrail on the compact
   * value — a category can be non-null and still never have been looked at
   * by a person.
   */
  declaredBySeller: boolean;
  onSave: (
    code: string,
  ) => Promise<
    { ok: true; categoryPath: string } | { ok: false; message: string }
  >;
};

const MAX_RESULTS = 20;
const PATH_SEPARATOR = ' > ';

type TreeNode = {
  name: string;
  /**
   * Set on the node a full path actually ends at. Taxonomy v1 stores a row
   * for every node — branches included — so a node can carry an `option`
   * AND children (e.g. "Apparel & Accessories" is its own `CAT-GGL-` row and
   * the parent of over a thousand more). Never read `option !== null` as
   * "leaf"; `children.size === 0` is the only leaf test.
   */
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
 * A picked category is not saved until "Save category" is pressed — this
 * changes only the one product open in this editor, never another product
 * or another seller's catalogue.
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
  declaredBySeller,
  onSave,
}: Sals3CategoryPickerProps) {
  const tree = useMemo(() => buildTree(options), [options]);

  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Sals3CategoryOption | null>(null);
  const [status, setStatus] = useState<
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [savedPath, setSavedPath] = useState<string | null>(null);
  /**
   * Same reasoning as the option-mapping summary card: `declaredBySeller`
   * only flips once `router.refresh()` round-trips and the read-model
   * re-derives it, so without this the red/caution guardrail would stay on
   * screen right after a successful save until that refresh lands.
   */
  const [justDeclared, setJustDeclared] = useState(false);

  const effectivePath = savedPath ?? currentPath;
  const effectiveDeclaredBySeller = justDeclared || declaredBySeller;

  const resetDialogState = useCallback(() => {
    setStack([]);
    setQuery('');
    setSelected(null);
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

  /**
   * Every path that is a strict prefix of some other path — i.e. a branch.
   * Search results consult this so the two modes agree on one rule: a
   * branch NAVIGATES (as it always has in browse mode), only a true leaf
   * is selectable. Before this set existed, searching "Apparel &
   * Accessories" let a seller select the department itself while browsing
   * to it could not — two different taxonomies depending on which box you
   * typed in.
   */
  const branchPaths = useMemo(() => {
    const set = new Set<string>();

    options.forEach((option) => {
      const segments = option.path.split(PATH_SEPARATOR);
      for (let depth = 1; depth < segments.length; depth += 1) {
        set.add(segments.slice(0, depth).join(PATH_SEPARATOR));
      }
    });

    return set;
  }, [options]);

  const currentNode = useMemo(() => nodeAt(tree, stack), [tree, stack]);
  const currentEntries = useMemo(
    () =>
      [...currentNode.children.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [currentNode],
  );

  const canSave = selected !== null;

  const handleSave = useCallback(async () => {
    if (selected === null) return;

    setStatus({ state: 'saving' });

    const result = await onSave(selected.code);

    if (result.ok) {
      setSavedPath(result.categoryPath);
      setJustDeclared(true);
      setOpen(false);
      resetDialogState();
    } else {
      setStatus({ state: 'error', message: result.message });
    }
  }, [onSave, resetDialogState, selected]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="editor-sals3-category-v1">Category</Label>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-sm">
        <span
          className={`flex min-w-0 items-center gap-1.5 truncate ${
            effectivePath !== null && !effectiveDeclaredBySeller
              ? 'font-medium text-red-600'
              : ''
          }`}
        >
          <span className="truncate">
            {effectivePath ?? (
              <span className="text-muted-foreground">Not set</span>
            )}
          </span>
          {effectivePath !== null && !effectiveDeclaredBySeller ? (
            <Tooltip>
              <TooltipTrigger
                aria-label="Not yet confirmed as Sals3 taxonomy"
                className="shrink-0 text-red-600"
              >
                <TriangleAlert aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>
                Still defaulted from CJ&rsquo;s own category — nobody has
                confirmed this as a Sals3 Taxonomy v1 category yet.
              </TooltipContent>
            </Tooltip>
          ) : null}
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
                    matches.map((option) => {
                      const isBranch = branchPaths.has(option.path);
                      return (
                        <li key={option.code}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => {
                              if (isBranch) {
                                // Same rule as browse mode: a branch is a
                                // place to go, not a category to assign.
                                setStack(option.path.split(PATH_SEPARATOR));
                                setQuery('');
                                return;
                              }
                              setSelected(option);
                              setQuery('');
                            }}
                          >
                            {option.path}
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
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
