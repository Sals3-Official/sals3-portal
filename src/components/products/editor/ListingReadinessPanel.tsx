import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  EditorSectionId,
  ProductEditorFixture,
} from '@/lib/seller-center/product-editor/types';
import ReadinessIssueList from './ReadinessIssueList';
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 @min-[48rem]:p-4">
      {showHeading ? (
        <h2 className="font-display text-[15px] font-semibold">
          Listing Readiness
        </h2>
      ) : null}

      <Tabs defaultValue="issues">
        <TabsList aria-label="Listing readiness" className="w-full">
          <TabsTrigger value="issues">
            Issues &amp; Tasks ({issueCount})
          </TabsTrigger>
          <TabsTrigger value="changes">
            Source Changes ({fixture.sourceChanges.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="flex flex-col gap-4 pt-1">
          <ReadinessSummary
            status={fixture.evaluationStatus}
            completionPercent={fixture.completionPercent}
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
          <SourceChangesPanel changes={fixture.sourceChanges} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
