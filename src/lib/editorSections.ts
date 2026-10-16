import { Building2, Send, Shield, List, BookOpen, Paperclip, User, Users, Layers, PenLine, Hash, ClipboardList, CornerDownRight, type LucideIcon } from 'lucide-react';
import type { DocTypeConfig, FormType } from '@/types/document';

export interface EditorSection {
  id: string;
  label: string;
  /** Leading glyph shown in the outline rail (matches the prototype's icon+label rows). */
  icon?: LucideIcon;
}

export function getEditorSections(config: DocTypeConfig, docType: string): EditorSection[] {
  const classification = { id: 'classification', label: 'Classification', icon: Shield };
  const body = { id: 'body', label: 'Paragraphs', icon: List };
  const references = { id: 'references', label: 'References', icon: BookOpen };
  const enclosures = { id: 'enclosures', label: 'Enclosures', icon: Paperclip };
  const copyto = { id: 'copyto', label: 'Copy to', icon: User };
  const distribution = { id: 'distribution', label: 'Distribution', icon: Layers };
  const signature = { id: 'signature', label: 'Signature', icon: PenLine };

  // MFR (Memorandum for the Record): a plain-paper record memo — no letterhead,
  // a simple "Heading" in place of From/To addressing, and no copy-to or
  // distribution (SECNAV M-5216.5 Ch 10 ¶1). Gated on the docType, not the
  // shared uiMode:'memo' (which also covers the From/To memo types that keep
  // the full section set).
  if (docType === 'mfr') {
    return [
      { id: 'addressing', label: 'Heading', icon: Send },
      classification,
      body,
      references,
      enclosures,
      signature,
    ];
  }

  switch (config.uiMode) {
    case 'moa':
      // MOA: the two signing commands are the "Parties"; agreements don't carry a
      // distribution block (SECNAV Ch 10 ¶6).
      return [{ id: 'moa', label: 'Parties', icon: Users }, classification, body, references, enclosures, copyto];
    case 'joint':
      return [{ id: 'joint', label: 'Commands', icon: Users }, classification, body, references, enclosures, copyto, distribution];
    case 'joint_memo':
      return [{ id: 'joint_memo', label: 'Commands', icon: Users }, classification, body, references, enclosures, copyto, distribution];
    case 'executive': {
      // Information memos sign on the FROM line, not with a signature block,
      // so they get no Signature section. Standard and action memos keep it.
      const base = [{ id: 'executive', label: 'Heading', icon: Send }, classification, body, copyto, distribution];
      return docType === 'information_memorandum' ? base : [...base, signature];
    }
    default: {
      // standard / memo / business. Drop Letterhead for types that don't use
      // one, otherwise it renders permanently disabled. Endorsements get a
      // dedicated "Basic Letter" section (ordinal + basic-letter id) ahead of
      // addressing, per the prototype.
      const isEndorsement = docType === 'same_page_endorsement' || docType === 'new_page_endorsement';
      return [
        ...(config.letterhead ? [{ id: 'letterhead', label: 'Letterhead', icon: Building2 }] : []),
        ...(isEndorsement ? [{ id: 'basic', label: 'Basic Letter', icon: CornerDownRight }] : []),
        { id: 'addressing', label: 'Addressing', icon: Send },
        classification,
        body,
        references,
        enclosures,
        copyto,
        distribution,
        signature,
      ];
    }
  }
}

/**
 * Section list for a Marine Corps form. The ids match the form's AccordionItem
 * values and anchor ids so the rail can jump to each group.
 */
export function getFormSections(formType: FormType): EditorSection[] {
  switch (formType) {
    case 'navmc_10274':
      return [
        { id: 'header', label: 'Header information', icon: Hash },
        { id: 'addressing', label: 'Addressing', icon: Send },
        { id: 'content', label: 'Counseling content', icon: ClipboardList },
        { id: 'signatures', label: 'Signatures', icon: PenLine },
        { id: 'references', label: 'References & distribution', icon: BookOpen },
      ];
    case 'navmc_118_11':
      return [
        { id: 'marine', label: 'Marine identification', icon: User },
        { id: 'content', label: 'Entry content', icon: ClipboardList },
        { id: 'signatures', label: 'Signatures', icon: PenLine },
      ];
    default:
      return [];
  }
}

