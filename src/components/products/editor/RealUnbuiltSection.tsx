import EditorSectionCard from './EditorSectionCard';

type RealUnbuiltSectionProps = {
  id: 'specs' | 'markets' | 'media';
  title: string;
  /** What the database actually holds for this section, stated plainly. */
  explanation: string;
  /** Where the work lives, so the section is not just a dead end. */
  nextStep: string;
};

/**
 * A section that exists in the design and has no data behind it yet.
 *
 * It renders as a real section card, in its real position, with real prose -
 * not as an empty box and not as a hidden section. Removing it would make the
 * editor look complete while quietly dropping a section the design requires;
 * faking inputs into it would be worse, because a seller would type into fields
 * whose values have nowhere to be stored.
 *
 * The severity is `BLOCKER` because every one of these genuinely blocks
 * publication, and the same three sections are flagged in the section nav.
 */
export default function RealUnbuiltSection({
  id,
  title,
  explanation,
  nextStep,
}: RealUnbuiltSectionProps) {
  return (
    <EditorSectionCard id={id} title={title} severity="BLOCKER">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">{explanation}</p>
        <p className="text-xs text-ink-subtle">{nextStep}</p>
      </div>
    </EditorSectionCard>
  );
}
