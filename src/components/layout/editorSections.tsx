import { useMemo, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { LetterheadSection } from '@/components/editor/LetterheadSection';
import { AddressingSection } from '@/components/editor/AddressingSection';
import { ITypeCoverSection } from '@/components/editor/ITypeCoverSection';
import { PublicationTablesSection } from '@/components/editor/PublicationTablesSection';
import { ClassificationSection } from '@/components/editor/ClassificationSection';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { ReferencesManager } from '@/components/editor/ReferencesManager';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { AcronymCheck } from '@/components/editor/AcronymCheck';
import { ParagraphStructureCheck } from '@/components/editor/ParagraphStructureCheck';
import { CopyToManager } from '@/components/editor/CopyToManager';
import { DistributionManager } from '@/components/editor/DistributionManager';
import { EndorsementBasicLetterSection } from '@/components/editor/EndorsementBasicLetterSection';
import { MOASection } from '@/components/editor/MOASection';
import { JointLetterSection } from '@/components/editor/JointLetterSection';
import { JointMemoSection } from '@/components/editor/JointMemoSection';
import { ExecutiveMemoSection } from '@/components/editor/ExecutiveMemoSection';
import { DOC_TYPE_CONFIG, type DocTypeConfig, type FormType } from '@/types/document';
import { unfilled } from '@/lib/requiredField';

/**
 * Ordered editor sections per document type, plus each section's renderer.
 * One source of truth for both FormPanel and the navigation rail. The section
 * set varies by config.uiMode.
 */
import { getEditorSections, getFormSections, type EditorSection } from '@/lib/editorSections';

/**
 * Section list derivation for the current document, shared by FormPanel (which
 * renders the sections) and EditorSidebar (the outline rail) so the two can't
 * drift out of sync.
 */
export function useEditorSections(): {
  sections: EditorSection[];
  config: DocTypeConfig;
  isFormsMode: boolean;
  formType: FormType;
} {
  const documentCategory = useDocumentStore((s) => s.documentCategory);
  const formType = useDocumentStore((s) => s.formType);
  const docType = useDocumentStore((s) => s.docType);
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isFormsMode = documentCategory === 'forms';
  const sections = useMemo(
    () => [
      // Document Type leads the outline (matches the prototype's first rail
      // section); it's always rendered at the top of the editor in both modes.
      { id: 'type', label: 'Document Type', icon: FileText },
      ...(isFormsMode ? getFormSections(formType) : getEditorSections(config, docType)),
    ],
    [isFormsMode, formType, docType] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { sections, config, isFormsMode, formType };
}

/**
 * Per-section error predicates for the rail. A section errors only when a
 * hard-required field is unfilled (empty or a bracketed placeholder like
 * [SUBJECT]); there's no positive "complete" counterpart. Surfaced only after
 * an export attempt, gated on uiStore.validationVisible.
 */
interface SectionErrorInput {
  unitLine1?: string;
  from?: string;
  to?: string;
  subject?: string;
  sigLast?: string;
}


/**
 * The hard-required correspondence sections — the ids getSectionError can flag.
 * The rail dots, the readiness meter, and getSectionError all key off this one
 * list so a section can't be "required" in one place and optional in another.
 * Keep in lockstep with the cases in getSectionError below.
 */
export const ERROR_BEARING_IDS = [
  'letterhead', 'addressing', 'body', 'signature', 'executive', 'joint_memo',
] as const;

export function getSectionError(
  id: string,
  formData: SectionErrorInput,
  paragraphs: { text?: string }[],
  config: DocTypeConfig
): boolean {
  switch (id) {
    case 'letterhead':
      // Don't flag a missing letterhead when the doc type allows plain paper
      // (optionalLetterhead, e.g. MFR/MF per SECNAV Ch. 10).
      return config.letterhead === true && !config.optionalLetterhead && unfilled(formData.unitLine1);
    case 'addressing': {
      // Only flag fields the doc type actually exposes. "From" renders only for
      // fromTo types; "To" renders for fromTo OR the business-letter
      // recipientAddress block. MFR / memos-for-the-record (fromTo:false, no
      // recipientAddress) show neither, so requiring them stamped a permanent,
      // unclearable error dot on the Heading section; business letters (no From)
      // got the same on the From check.
      const fromError = config.fromTo ? unfilled(formData.from) : false;
      // "To" also carries the Memorandum For addressee — the doc type renders a
      // dedicated required field for its "MEMORANDUM FOR [addressee]" title line.
      const toError =
        config.fromTo || config.recipientAddress || config.memoTitle === 'MEMORANDUM FOR'
          ? unfilled(formData.to)
          : false;
      return fromError || toError || unfilled(formData.subject);
    }
    case 'body':
      return !paragraphs.some((p) => !unfilled(p.text));
    case 'signature':
      return unfilled(formData.sigLast);
    case 'executive':
    case 'joint_memo':
      // The executive- and joint-memo heading sections render a required
      // Subject (bound to formData.subject, same as the 'addressing' check).
      // Without this they fell through to default:false and never flagged an
      // empty subject. The field is rendered, so the dot stays clearable.
      return unfilled(formData.subject);
    default:
      return false;
  }
}

/**
 * Per-group error predicate for the NAVMC forms; the forms-mode counterpart
 * of getSectionError. Same "hard-required field unfilled" rule; ids match
 * getFormSections.
 */
interface FormSectionErrorInput {
  // NAVMC 10274 (6105 counseling)
  from?: string;
  to?: string;
  natureOfAction?: string;
  // NAVMC 11811 (Administrative Remarks / Page 11)
  lastName?: string;
  firstName?: string;
  edipi?: string;
  remarksText?: string;
  remarksTextRight?: string;
}

export function getFormSectionError(
  formType: FormType,
  id: string,
  form: FormSectionErrorInput
): boolean {
  if (formType === 'navmc_10274') {
    switch (id) {
      case 'addressing':
        return unfilled(form.from) || unfilled(form.to);
      case 'content':
        return unfilled(form.natureOfAction);
      default:
        return false;
    }
  }
  if (formType === 'navmc_118_11') {
    switch (id) {
      case 'marine':
        return unfilled(form.lastName) || unfilled(form.firstName) || unfilled(form.edipi);
      case 'content':
        // 11811 has a two-column remarks layout; either column alone is valid.
        return unfilled(form.remarksText) && unfilled(form.remarksTextRight);
      default:
        return false;
    }
  }
  return false;
}

/** Per-form section ids that getFormSectionError validates (forms counterpart of ERROR_BEARING_IDS). */
export const FORM_ERROR_BEARING_IDS: Partial<Record<FormType, string[]>> = {
  navmc_10274: ['addressing', 'content'],
  navmc_118_11: ['marine', 'content'],
};

export interface DocumentCompleteness {
  /** Hard-required sections present in this document. */
  required: number;
  /** Of those, how many have no outstanding error. */
  complete: number;
  /** complete / required — 0 when nothing is required yet. */
  ratio: number;
  /** Every required section satisfied (and there is at least one). */
  isReady: boolean;
  /** Ids of the still-incomplete required sections. */
  missing: string[];
}

export function completenessFrom(requiredIds: string[], isError: (id: string) => boolean): DocumentCompleteness {
  const missing = requiredIds.filter(isError);
  const required = requiredIds.length;
  const complete = required - missing.length;
  return {
    required,
    complete,
    ratio: required ? complete / required : 0,
    isReady: required > 0 && missing.length === 0,
    missing,
  };
}

/**
 * Single source of truth for "how done is this document," derived from the same
 * getSectionError / getFormSectionError rules the rail dots use — so the
 * readiness meter and the rail can never disagree.
 */
export function useDocumentCompleteness(): DocumentCompleteness {
  const { sections, config, isFormsMode, formType } = useEditorSections();
  const formData = useDocumentStore((s) => s.formData);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const navmc10274 = useFormStore((s) => s.navmc10274);
  const navmc11811 = useFormStore((s) => s.navmc11811);
  const idKey = sections.map((s) => s.id).join(',');
  return useMemo(() => {
    const ids = idKey ? idKey.split(',') : [];
    if (isFormsMode) {
      const data = formType === 'navmc_10274' ? navmc10274 : formType === 'navmc_118_11' ? navmc11811 : null;
      const required = (FORM_ERROR_BEARING_IDS[formType] ?? []).filter((id) => ids.includes(id));
      return completenessFrom(required, (id) => (data ? getFormSectionError(formType, id, data) : false));
    }
    const required = ids.filter((id) => (ERROR_BEARING_IDS as readonly string[]).includes(id));
    return completenessFrom(required, (id) => getSectionError(id, formData, paragraphs, config));
  }, [idKey, isFormsMode, formType, navmc10274, navmc11811, formData, paragraphs, config]);
}

export function renderEditorSection(id: string, config: DocTypeConfig): ReactNode {
  switch (id) {
    case 'letterhead':
      return <LetterheadSection />;
    case 'addressing':
      return <AddressingSection config={config} />;
    case 'basic':
      return <EndorsementBasicLetterSection />;
    case 'cover':
      return <ITypeCoverSection />;
    case 'tables':
      return <PublicationTablesSection />;
    case 'classification':
      return <ClassificationSection />;
    case 'body':
      return (
        <div className="space-y-3">
          <BlockParagraphsEditor />
          <ParagraphStructureCheck />
          <AcronymCheck />
        </div>
      );
    case 'references':
      return <ReferencesManager />;
    case 'enclosures':
      return <EnclosuresManager />;
    case 'copyto':
      return <CopyToManager />;
    case 'distribution':
      return <DistributionManager />;
    case 'signature':
      return <SignatureSection config={config} />;
    case 'moa':
      return <MOASection />;
    case 'joint':
      return <JointLetterSection />;
    case 'joint_memo':
      return <JointMemoSection />;
    case 'executive':
      return <ExecutiveMemoSection />;
    default:
      return null;
  }
}
