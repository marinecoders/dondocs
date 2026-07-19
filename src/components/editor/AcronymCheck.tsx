import { useMemo } from 'react';
import { SpellCheck } from 'lucide-react';
import { Notice } from '@/components/ui/notice';
import { useDocumentStore } from '@/stores/documentStore';
import { findUndefinedAcronyms } from '@/lib/acronyms';

/**
 * Advisory "spell out on first use" check for a letter/memo body (SECNAV
 * M-5216.5 ¶17c). Reads the body paragraphs, flags acronyms that are used before
 * they're defined as "Spelled Out (ACRONYM)", and reminds the drafter to define
 * them — never blocking, hidden when the body is clean. Only mounts in the
 * correspondence body section, so it applies to letters and memoranda, not the
 * recordkeeping forms.
 */
export function AcronymCheck() {
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const docType = useDocumentStore((s) => s.docType);

  const findings = useMemo(() => {
    const body = paragraphs.map((p) => p.text ?? '').join('\n');
    // Directives must define every acronym (¶17a); no directive doc type exists
    // yet, so this stays lenient today.
    return findUndefinedAcronyms(body, { strict: docType === 'directive' });
  }, [paragraphs, docType]);

  if (findings.length === 0) return null;

  return (
    <div aria-live="polite">
      <Notice variant="warning">
        <div className="flex items-start gap-2">
          <SpellCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Spell out on first use</p>
            <p className="text-muted-foreground">
              {findings.length === 1 ? 'This acronym is' : 'These acronyms are'} used before being
              defined:{' '}
              {findings.map((f, i) => (
                <span key={f.acronym}>
                  {i > 0 && ', '}
                  <span className="font-medium text-foreground">{f.acronym}</span>
                </span>
              ))}
              . Spell each out with the acronym in parentheses the first time — e.g.{' '}
              <span className="italic">North Atlantic Treaty Organization (NATO)</span> — then the
              acronym may stand alone. (SECNAV M-5216.5 ¶17c)
            </p>
          </div>
        </div>
      </Notice>
    </div>
  );
}
