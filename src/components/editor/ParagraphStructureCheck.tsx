import { useMemo } from 'react';
import { ListTree } from 'lucide-react';
import { Notice } from '@/components/ui/notice';
import { useDocumentStore } from '@/stores/documentStore';
import { validateParagraphStructure } from '@/lib/paragraphStructureValidation';

/**
 * Advisory paragraph-structure check for a letter/memo body: a subparagraph
 * with no sibling (SECNAV M-5216.5 Ch 7 ¶13) and headings applied to some
 * siblings but not all (¶13d). Never blocking, hidden when the body is clean.
 *
 * Mounts in the correspondence body section, which every doc type includes, so
 * the rules reach letters, memoranda and endorsements alike — and not the
 * recordkeeping forms, which have no paragraph tree.
 */
export function ParagraphStructureCheck() {
  const paragraphs = useDocumentStore((s) => s.paragraphs);

  const findings = useMemo(() => validateParagraphStructure(paragraphs), [paragraphs]);

  if (findings.length === 0) return null;

  return (
    <div aria-live="polite">
      <Notice variant="warning">
        <div className="flex items-start gap-2">
          <ListTree className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Check paragraph structure</p>
            {findings.map((f) => (
              <p key={f.message} className="text-muted-foreground">
                {f.message}
              </p>
            ))}
          </div>
        </div>
      </Notice>
    </div>
  );
}
