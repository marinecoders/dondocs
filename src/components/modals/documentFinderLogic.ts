// Document Finder — questions and recommendation logic.
//
// Pure, framework-free: the finder UI (DocumentFinder in DocumentGuideModal)
// renders these, and tests/unit/documentFinder.test.ts enumerates them. Kept in
// its own module so the component file can stay a component-only export (and so
// the decision tree is testable without mounting any React).
//
// The finder is a short branching interview, not a fixed list. A first
// "category" question splits correspondence / Marine Corps form / for-the-record;
// two follow-ups (joint signature, agreement resources) appear only when they
// apply. `getNextQuestion` walks FLOW and returns the first askable, unanswered
// question — null means we have enough to recommend. Every branching question
// carries an "I'm not sure" option so a clerk who doesn't know the jargon still
// reaches a sensible result instead of a dead end.

export interface QuestionOption {
  label: string;
  value: string;
  help?: string;
}

export interface Question {
  id: string;
  question: string;
  help?: string;
  options: QuestionOption[];
}

export const QUESTIONS: Record<string, Question> = {
  category: {
    id: 'category',
    question: 'What are you trying to create?',
    help: "Pick the closest — we'll narrow it down from there.",
    options: [
      { label: 'A letter, memo, or other written correspondence', value: 'correspondence', help: 'Anything sent to a command, person, or business.' },
      { label: 'A Marine Corps personnel / service-record form', value: 'usmc_form', help: 'Page 11 (NAVMC 118(11)) or an administrative-action form. Marine Corps only.' },
      { label: 'A record of a counseling, event, or decision for the file', value: 'record', help: 'No one receives it — it just goes in the file.' },
      { label: 'A technical publication directing work on fielded equipment', value: 'techpub', help: 'A Modification, Supply, Technical, or Lubrication Instruction (MI/SI/TI/LI), issued under a PCN.' },
    ],
  },
  formType: {
    id: 'formType',
    question: 'What does the form need to do?',
    help: 'Marine Corps service-record items (MCO P1070.12K).',
    options: [
      { label: 'Make a service-record entry — counseling, 6105 notice, or commendation', value: 'page11', help: "Goes on the Marine's Page 11 (NAVMC 118(11))." },
      { label: 'Process an administrative action — separation, NJP, or admin decision', value: 'adminAction', help: 'Uses the Administrative Action form (NAVMC 10274).' },
      { label: "I'm not sure", value: 'unsure', help: "We'll show both and explain the difference." },
    ],
  },
  recipient: {
    id: 'recipient',
    question: 'Who is the primary recipient?',
    options: [
      { label: 'Another military command, unit, or service member', value: 'military', help: 'Another command or a member acting in an official capacity.' },
      { label: 'A civilian person or business', value: 'civilian', help: 'Contractors, vendors, the public, or any non-DoD entity.' },
      { label: 'Several commands or addressees at once', value: 'multiple', help: 'The same content going to multiple recipients.' },
      { label: "I'm not sure", value: 'unsure', help: "We'll show the most common formats and the difference." },
    ],
  },
  jointSignature: {
    id: 'jointSignature',
    question: 'Will two different commands co-sign this document?',
    help: 'A joint document is signed by both commands so they speak with one voice. This is rare — most letters have a single signer.',
    options: [
      { label: 'No — one command signs', value: 'no', help: 'The normal case.' },
      { label: 'Yes — two commands both sign it', value: 'yes', help: 'About two signers, not two recipients.' },
    ],
  },
  purpose: {
    id: 'purpose',
    question: 'What is the main purpose?',
    options: [
      { label: 'Make a request, recommendation, or tasking', value: 'request' },
      { label: 'Provide information or a status update', value: 'inform' },
      { label: 'Present options for someone to decide', value: 'decision' },
      { label: 'Document an event for the record', value: 'document' },
      { label: 'Establish an agreement between two parties', value: 'agreement' },
      { label: 'Endorse or forward a letter I received', value: 'response' },
      { label: "I'm not sure", value: 'unsure' },
    ],
  },
  resources: {
    id: 'resources',
    question: 'Does this agreement commit specific resources?',
    help: 'Money, people, equipment, or measurable deliverables — vs. just defining roles.',
    options: [
      { label: 'Yes — it commits funding, personnel, or deliverables', value: 'yes', help: 'e.g., "we will fund $50k" or "we will provide 3 instructors."' },
      { label: 'No — it defines roles or a framework for cooperation', value: 'no', help: 'e.g., "we agree to coordinate scheduling" — no money or people committed.' },
      { label: "I'm not sure yet", value: 'unsure', help: "We'll show both and explain when each applies." },
    ],
  },
  routing: {
    id: 'routing',
    question: 'How will this be routed?',
    options: [
      { label: 'Direct to the recipient', value: 'direct', help: 'Straight to the addressee.' },
      { label: 'Through the chain of command (Via line)', value: 'via', help: 'Passes through one or more commands first.' },
      { label: 'Internal, within my own command', value: 'internal', help: 'Stays inside your command or office.' },
    ],
  },
  formality: {
    id: 'formality',
    question: 'What level of formality is needed?',
    options: [
      { label: 'Formal, on official letterhead', value: 'formal' },
      { label: 'Routine / working level', value: 'informal' },
      { label: 'Flag / General-officer level', value: 'executive', help: 'Signed by or addressed to an admiral or general.' },
    ],
  },
};

// Canonical question order + the condition under which each is asked. Skips are
// declarative here so the flow stays readable; getNextQuestion does the walk.
export const FLOW: { id: string; ask: (a: Record<string, string>) => boolean }[] = [
  { id: 'category', ask: () => true },
  { id: 'formType', ask: (a) => a.category === 'usmc_form' },
  { id: 'recipient', ask: (a) => a.category === 'correspondence' },
  { id: 'jointSignature', ask: (a) => a.category === 'correspondence' && a.recipient === 'military' },
  { id: 'purpose', ask: (a) => a.category === 'correspondence' },
  { id: 'resources', ask: (a) => a.category === 'correspondence' && a.purpose === 'agreement' },
  { id: 'routing', ask: (a) => a.category === 'correspondence' && a.purpose !== 'agreement' },
  { id: 'formality', ask: (a) => a.category === 'correspondence' && a.purpose !== 'agreement' },
];

/** First askable, unanswered question for the current answers; null ⇒ show results. */
export function getNextQuestion(answers: Record<string, string>): Question | null {
  for (const step of FLOW) {
    if (step.ask(answers) && answers[step.id] === undefined) {
      return QUESTIONS[step.id];
    }
  }
  return null;
}

export interface FinderResult {
  docType: string;
  confidence: 'high' | 'medium';
  reason: string;
}

// Maps a finder interview to recommended document types. Ordered, early-return
// rules — the FIRST matching rule wins, so rule order is load-bearing (e.g. R5
// joint sits above R6-R12; R10's MF precedence above the default letters). The
// design covers all 19 types; see the enumeration test in
// tests/unit/documentFinder.test.ts which guards that none go unreachable.
export function getRecommendations(answers: Record<string, string>): FinderResult[] {
  const { category, formType, recipient, jointSignature, purpose, routing, formality } = answers;
  const joint = jointSignature === 'yes';           // safe default: undefined → false
  const res = answers.resources ?? 'unsure';         // MOA/MOU axis, defaults to unsure
  const results: FinderResult[] = [];
  const add = (docType: string, confidence: 'high' | 'medium', reason: string) =>
    results.push({ docType, confidence, reason });
  // At most three cards; rule order is high-first, so the cap never drops the
  // best match. Only results[0] is badged "Best Match" in the render.
  const top3 = () => results.slice(0, 3);

  // R0 — Marine Corps forms (NAVMC). The only path that reaches the Forms group.
  if (category === 'usmc_form') {
    if (formType === 'page11') {
      add('navmc_118_11', 'high', 'Per MCO P1070.12K: Page 11 (NAVMC 118(11)) service-record entry for counseling, 6105 notices, and commendations');
    } else if (formType === 'adminAction') {
      add('navmc_10274', 'high', 'Per MCO P1070.12K: Administrative Action form (NAVMC 10274) for separations, NJP, and command admin decisions');
    } else {
      add('navmc_118_11', 'high', 'Per MCO P1070.12K: use a Page 11 (NAVMC 118(11)) to record counseling or an event in the service record');
      add('navmc_10274', 'medium', 'Per MCO P1070.12K: use the Administrative Action form (NAVMC 10274) for a separation, NJP, or formal admin decision');
    }
    return top3();
  }

  // R1 — For the record (Q0 fast path). No recipient context, so do NOT nudge a
  // USMC-only Page 11 here; that lives behind the explicit form path (R0).
  if (category === 'record') {
    add('mfr', 'high', 'Per Ch 10: Memorandum for the Record documents meetings, decisions, or events for the official record');
    return top3();
  }

  // R1a — Technical publications. Not correspondence: an I-Type is a directive
  // to the fleet, authenticated on its front matter, under MIL-STD-38784C.
  if (category === 'techpub') {
    add('i_type', 'high', 'Per MIL-STD-38784C: an I-Type instruction (MI/SI/TI/LI) directs a modification, supply, technical, or lubrication action on fielded equipment');
    return top3();
  }

  // R2 — Endorsements. Single-command forwards; joint is intentionally ignored
  // (a joint letter is not an endorsement).
  if (purpose === 'response') {
    if (formality === 'informal' || routing === 'internal') {
      add('same_page_endorsement', 'high', 'Per Ch 7: Brief endorsement added below the basic letter when space permits');
      add('new_page_endorsement', 'medium', 'Use a new-page endorsement if it is lengthy or the basic letter page is full');
    } else {
      add('new_page_endorsement', 'high', 'Per Ch 7: New-page endorsement on its own letterhead for formal or detailed responses');
      add('same_page_endorsement', 'medium', 'Alternative if the endorsement is brief and fits on the original letter');
    }
    return top3();
  }

  // R3 — Civilian recipient.
  if (recipient === 'civilian') {
    add('business_letter', 'high', 'Per Ch 11: Business-letter format for civilians, contractors, and non-DoD entities');
    return top3();
  }

  // R4 — Agreements. Resources-driven (MOA = commitments, MOU = framework).
  // Joint co-signature surfaces joint variants without overriding MOA/MOU.
  if (purpose === 'agreement') {
    if (res === 'yes') {
      add('moa', 'high', 'Per Ch 12: MOA when the agreement commits specific funding, personnel, or measurable deliverables');
      add('mou', 'medium', 'Use an MOU instead if it only frames roles and cooperation without committing resources');
    } else if (res === 'no') {
      add('mou', 'high', 'Per Ch 12: MOU to define roles, responsibilities, and a framework for cooperation without committing resources');
      add('moa', 'medium', 'Upgrade to an MOA if you later commit specific funding, personnel, or deliverables');
    } else {
      add('mou', 'high', 'Per Ch 12: Start with an MOU for the working framework — it is the lower-commitment option');
      add('moa', 'medium', 'Choose an MOA if the agreement will commit specific resources or funding');
    }
    if (joint) {
      add('joint_letter', 'medium', 'Per Ch 2: Joint letter when two commands co-sign the agreement to speak with one voice');
      add('joint_memorandum', 'medium', 'Per Ch 12: Joint memorandum when two staffs present a single coordinated position internally');
    }
    return top3();
  }

  // R5 — Joint correspondence, non-agreement. Sits ABOVE R6-R12: a co-signed
  // document's format is driven by whether it leaves the command (joint letter)
  // or stays an internal coordinated staff product (joint memo). Q-JOINT is only
  // asked when recipient==='military', so joint implies military here.
  if (joint && recipient === 'military') {
    if (routing === 'via' || routing === 'direct') {
      add('joint_letter', 'high', 'Per Ch 2: Joint letter when two commands co-sign correspondence that leaves the command to speak with one voice');
      add('joint_memorandum', 'medium', 'Use a joint memorandum if this stays an internal coordinated staff position rather than outgoing correspondence');
    } else {
      add('joint_memorandum', 'high', 'Per Ch 12: Joint memorandum when two staffs co-sign an internal coordinated position');
      add('joint_letter', 'medium', 'Use a joint letter if it instead leaves the command as official outgoing correspondence');
    }
    return top3();
  }

  // R6 — Decision memos.
  if (purpose === 'decision') {
    add('decision_memorandum', 'high', 'Per Ch 12: Decision memo presents options with pros/cons and a staff recommendation');
    if (formality === 'executive') {
      add('executive_memorandum', 'medium', 'Alternative at flag/general-officer level using an executive-summary format');
    } else {
      add('naval_letter', 'medium', 'Use a naval letter if the decision must be formally requested up the chain of command');
    }
    return top3();
  }

  // R7 — Multiple addressees (single-signer).
  if (recipient === 'multiple') {
    add('multiple_address_letter', 'high', 'Per Ch 2: Multiple-address letter for identical content sent to several commands at once');
    add('naval_letter', 'medium', 'Alternative: a naval letter with the recipients in a distribution / Copy To list');
    return top3();
  }

  // R8 — Executive / flag level. Both executive types co-appear.
  if (formality === 'executive') {
    if (routing === 'internal' || purpose === 'inform') {
      add('executive_memorandum', 'high', 'Per Ch 12: Executive memo for staff-to-senior briefings and status to senior leadership');
      add('executive_correspondence', 'medium', 'Use executive correspondence if this goes peer-to-peer between flag/general officers');
    } else {
      add('executive_correspondence', 'high', 'Per Ch 12: Executive correspondence for flag-to-flag, peer senior-official communication');
      add('executive_memorandum', 'medium', 'Use an executive memo if this is a staff-to-senior briefing within the chain');
    }
    add('naval_letter', 'medium', 'A naval letter is also appropriate for formal executive matters needing an official record');
    return top3();
  }

  // R9 — Documenting an event.
  if (purpose === 'document') {
    add('mfr', 'high', 'Per Ch 10: MFR documents meetings, verbal orders, decisions, or events for the official record');
    if (routing === 'internal') {
      add('letterhead_memorandum', 'medium', 'Alternative: a letterhead memo if the record must be shared formally within the command');
    } else if (routing === 'via') {
      add('naval_letter', 'medium', 'Use a naval letter if the documented matter must be forwarded up the chain of command');
    }
    return top3();
  }

  // R10 — Internal / routine. MF precedence: a formal "Memorandum For" addressed
  // to a person/office leads for staff actions and information; letterhead memo
  // leads when it may be forwarded externally.
  if (routing === 'internal') {
    if (formality === 'informal') {
      add('plain_paper_memorandum', 'high', 'Per Ch 12: Plain-paper memo for routine internal working-level communication');
      add('standard_letter', 'medium', 'Alternative: a plain-paper standard letter for an internal draft or review copy');
    } else if (purpose === 'inform' || purpose === 'request') {
      add('mf', 'high', 'Per Ch 10: "Memorandum For" addressed to a specific person/office for internal staff action');
      add('letterhead_memorandum', 'medium', 'Use a letterhead memo if it may be forwarded externally or needs an SSIC');
    } else {
      add('letterhead_memorandum', 'high', 'Per Ch 12: Letterhead memo for formal internal communications that may be forwarded');
      add('mf', 'medium', 'Alternative: "Memorandum For" format addressed to a specific person/office');
    }
    return top3();
  }

  // R11 — Chain-of-command routing (via).
  if (routing === 'via') {
    add('naval_letter', 'high', 'Per Ch 2: Naval letter with a Via line for correspondence routed through the chain of command');
    if (formality === 'informal') {
      add('standard_letter', 'medium', 'Alternative: a standard letter (same format, no letterhead) for a draft or when letterhead is unavailable');
    }
    return top3();
  }

  // R12 — Default (direct routing).
  if (formality === 'formal') {
    add('naval_letter', 'high', 'Per Ch 2: Naval letter is the standard format for official Department of the Navy correspondence');
  } else {
    add('naval_letter', 'high', 'Per Ch 2: Naval letter is appropriate for most official military correspondence');
    add('standard_letter', 'medium', 'Alternative: a standard letter (same format) when letterhead is not required or available');
  }
  return top3();
}

/** A short, context-independent contrast for each type, for the "How to choose"
 *  strip when a rule returns two candidates differing on one axis. */
export const DOC_DIFFERENTIATORS: Record<string, string> = {
  moa: 'Commits specific resources or funding',
  mou: 'Frames roles & cooperation, no resources',
  same_page_endorsement: 'Brief — fits on the basic letter',
  new_page_endorsement: 'Longer — its own letterhead page',
  joint_letter: 'Leaves the command as outgoing correspondence',
  joint_memorandum: 'Stays an internal coordinated staff position',
  executive_memorandum: 'Staff → senior leadership',
  executive_correspondence: 'Flag-to-flag, peer level',
  multiple_address_letter: 'Built for several addressees at once',
  naval_letter: 'Standard single-recipient official letter',
  plain_paper_memorandum: 'Routine internal, working level',
  standard_letter: 'Same format, no letterhead',
  mf: 'Addressed to a specific person/office',
  letterhead_memorandum: 'Formal, may be forwarded / needs SSIC',
  decision_memorandum: 'Presents options for a decision',
  mfr: 'Records an event for the file',
  navmc_118_11: 'Service-record (Page 11) entry',
  navmc_10274: 'Administrative-action processing',
  business_letter: 'For civilian / non-DoD recipients',
};

/** Split a reason into its citation chip ("Ch 10", "MCO P1070.12K") and the
 *  plain-language "why". Reasons that don't start with "Per …:" render whole. */
export function splitReason(reason: string): { cite: string | null; why: string } {
  const m = reason.match(/^Per ([^:]+):\s*(.*)$/);
  return m ? { cite: m[1], why: m[2] } : { cite: null, why: reason };
}
