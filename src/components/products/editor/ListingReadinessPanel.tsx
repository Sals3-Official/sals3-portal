import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  EditorSectionId,
  ProductEditorFixture,
} from '@/lib/seller-center/product-editor/types';
import ReadinessIssueList from './ReadinessIssueList';
import ReadinessStatusHeader from './ReadinessStatusHeader';
import ReadinessSummary from './ReadinessSummary';
import SourceChangesPanel from './SourceChangesPanel';

type ListingReadinessPanelProps = {
  fixture: ProductEditorFixture;
  blockerCount: number;
  warningCount: number;
  suggestionCount: number;
  onGoToSection: (section: EditorSectionId) => void;
  /** Off inside a sheet, whose own title already names the panel. */
  showHeading?: boolean;
  /**
   * Caps the visible issue list to the most important few and offers
   * "View all issues" instead. Used for the sticky rail, where a verbose
   * warning list would need its own nested scrollbar; the sheet opened by
   * "View all issues" reads the full list uncapped.
   */
  compact?: boolean;
  /** Required when `compact` is set. Opens the full Listing Readiness sheet. */
  onViewAll?: () => void;
};

/**
 * The left rail: everything standing between this draft and publication.
 *
 * Two tabs and no more. There is deliberately no "AI optimised" tab and no
 * per-warning approval step - warnings publish, and stay visible after
 * publication until they are resolved or the supplier evidence changes.
 */
export default function ListingReadinessPanel({
  fixture,
  blockerCount,
  warningCount,
  suggestionCount,
  onGoToSection,
  showHeading = true,
  compact = false,
  onViewAll,
}: ListingReadinessPanelProps) {
  const issueCount = blockerCount + warningCount + suggestionCount;

  return (
    <div className="@container flex flex-col gap-3 rounded-lg border border-border bg-card p-3 @min-[48rem]:p-4">
      {/*
        One header block: what this panel is, then the listing's state, then
        how close it is. Grouping the title with the status under a single
        `gap-2` keeps them reading as one unit - previously the tab strip sat
        between them, which made an empty band the eye read as a broken inner
        card.
      */}
      <div className="flex flex-col gap-2">
        {showHeading ? (
          <h2 className="font-display text-[15px] font-semibold">
            Listing Readiness
          </h2>
        ) : null}

        <ReadinessStatusHeader
          status={fixture.evaluationStatus}
          completionPercent={fixture.completionPercent}
        />
      </div>

      <Tabs defaultValue="issues">
        {/*
          `grid-cols-2` rather than the primitive's default `flex`: two equal
          halves that cannot push each other out of the rail.

          The rail gives each tab ~109px of text. "Source Changes (0)" needs
          133px at the primitive's 14px, and still needs 107px at 11px - a
          size too small for a primary control. Every option that keeps the
          long label at that width ends in an ellipsis, so below 19rem of
          panel the label shortens.

          The switch is a container query on the panel, not the `compact`
          prop: `compact` describes the rail, but the sheet is just as narrow
          on a 320px phone, and keying off the prop left the sheet clipping
          there. Panel width is the thing that actually decides whether the
          text fits.

          Both variants are real elements toggled with `hidden`, so the one
          that is not shown is display:none and therefore excluded from the
          accessible name. Visible text and accessible name stay identical at
          every width - a tab announced as something other than what it reads
          is a worse defect than a shortened word (WCAG 2.5.3).
        */}
        <TabsList
          aria-label="Listing readiness"
          className="grid w-full grid-cols-2"
        >
          <TabsTrigger value="issues" className="min-w-0 gap-1">
            <span className="truncate">
              <span className="@min-[19rem]:hidden">Issues</span>
              <span className="hidden @min-[19rem]:inline">
                Issues &amp; Tasks
              </span>
            </span>{' '}
            <span className="shrink-0 tabular-nums">({issueCount})</span>
          </TabsTrigger>
          <TabsTrigger value="changes" className="min-w-0 gap-1">
            <span className="truncate">
              <span className="@min-[19rem]:hidden">Changes</span>
              <span className="hidden @min-[19rem]:inline">Source Changes</span>
            </span>{' '}
            <span className="shrink-0 tabular-nums">
              ({fixture.sourceChanges.length})
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="flex flex-col gap-3 pt-1">
          <ReadinessSummary
            blockerCount={blockerCount}
            warningCount={warningCount}
            suggestionCount={suggestionCount}
            lastValidatedAt={fixture.lastValidatedAt}
          />
          <ReadinessIssueList
            issues={fixture.issues}
            onGoToSection={onGoToSection}
            maxVisible={compact ? 4 : null}
            onViewAll={onViewAll}
          />
        </TabsContent>

        <TabsContent value="changes" className="pt-1">
          <SourceChangesPanel
            changes={fixture.sourceChanges}
            evidenceCapturedAt={fixture.sourceChangesCapturedAt}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
