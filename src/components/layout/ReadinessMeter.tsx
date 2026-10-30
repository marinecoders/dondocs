import { useEffect, useRef, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { IconTip } from '@/components/ui/icon-tip';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useDocumentCompleteness } from './editorSections';

/**
 * Required-field completeness, available independently of the preview.
 *
 * Driven by useDocumentCompleteness — the same getSectionError / getFormSectionError
 * rule the navigation-rail dots use — so the meter and the rail can never
 * disagree about whether a section is done. While drafting, the meter doubles as
 * a "jump to the first incomplete section" control. Lives in its own component
 * so the keystroke-frequency completeness subscription re-renders only this
 * ring, not the whole PreviewPanel.
 */
export function ReadinessMeter() {
  const { ratio, isReady, complete, required, missing } = useDocumentCompleteness();
  const isGenericForm = useDocumentStore(s => s.documentCategory === 'forms' && !!s.genericForm);
  const isSl3 = useDocumentStore((s) => s.docType === 'sl3');
  const documentMode = useDocumentStore((s) => s.documentMode);
  const jump = useEditorOutlineStore((s) => s.jump);

  // Fire one restrained "arrival" beat the moment the document crosses from
  // incomplete to complete (edge-triggered so it never loops while complete).
  const [justReady, setJustReady] = useState(false);
  const prevReady = useRef(isReady);
  useEffect(() => {
    if (isReady && !prevReady.current) {
      setJustReady(true);
      const t = setTimeout(() => setJustReady(false), 700);
      prevReady.current = isReady;
      return () => clearTimeout(t);
    }
    prevReady.current = isReady;
  }, [isReady]);

  // Nothing required yet (e.g. a doc type with no hard-required sections) — no
  // meaningful progress to show.
  if (required === 0 && !isGenericForm) return null;

  const r = 8;
  const circumference = 2 * Math.PI * r;
  const label = isReady ? (isGenericForm ? 'Fields complete' : 'Required fields complete') : `${missing.length} incomplete section${missing.length === 1 ? '' : 's'}`;
  const canJump = !isReady && missing.length > 0;

  const inner = (
    <>
      <span
        className={`relative inline-flex h-5 w-5 items-center justify-center ${
          justReady ? 'motion-safe:animate-[dd-ready-pop_600ms_ease-out]' : ''
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden="true">
          <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2" className="stroke-border" />
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-primary"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            style={{ transition: 'stroke-dashoffset 300ms ease' }}
          />
        </svg>
        {isReady && (
          <Check
            className={`absolute h-2.5 w-2.5 text-primary ${
              justReady ? 'motion-safe:animate-[dd-pop-in_500ms_ease-out]' : ''
            }`}
            strokeWidth={3}
            aria-hidden="true"
          />
        )}
      </span>
      <span className={isReady ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {documentMode === 'compliant' && !isGenericForm && (
        <span
          className="hidden items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground md:inline-flex"
          title={isSl3 ? "SL-3 template preview. Font and source-template exceptions remain; this is not a compliance certification." : "Built to the SECNAV M-5216.5 / MCO 5216.19A compliant format"}
        >
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {isSl3 ? 'SL-3 preview' : 'Compliant mode'}
        </span>
      )}

      {canJump ? (
        <IconTip label={`${complete} of ${required} required sections complete — jump to the first incomplete one`}>
          <button
            type="button"
            onClick={() => jump(missing[0])}
            aria-label={`Required fields: ${complete} of ${required} sections complete. Jump to the first incomplete section.`}
            className="flex min-h-11 sm:min-h-8 items-center gap-1.5 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {inner}
          </button>
        </IconTip>
      ) : (
        <div
          className="flex items-center gap-1.5"
          title="Required fields are filled. Review the generated document, attachments, and signatures before use."
          aria-label={`${label}. Review the generated document, attachments, and signatures before use.`}
        >
          {inner}
        </div>
      )}
    </div>
  );
}
