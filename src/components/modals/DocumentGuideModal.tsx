import { useState, useMemo } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, ChevronLeft, FileText, CheckCircle2, Lightbulb, BookOpen, Sparkles, ArrowRight, RotateCcw, Search, Eye, Check, Zap, Layers, Users, FolderOpen, Paperclip, PenLine, Link2, Shield, MapPin, File, Briefcase, Mail, ClipboardCheck, ClipboardList, BookMarked, Scale, Award, ScrollText, FileSignature, Star, FolderSync, type LucideIcon } from 'lucide-react';

// Lucide icons for document types / groups / categories, keyed by id — the
// app uses lucide everywhere else, so the guide should too (the old emoji
// `icon` fields in documentGuide.ts are no longer rendered).
const DOC_TYPE_ICONS: Record<string, LucideIcon> = {
  naval_letter: FileText, standard_letter: File, business_letter: Briefcase,
  multiple_address_letter: Mail, joint_letter: Users, same_page_endorsement: CheckCircle2,
  new_page_endorsement: ClipboardCheck, mfr: BookMarked, mf: FileText,
  plain_paper_memorandum: File, letterhead_memorandum: FileText, decision_memorandum: Scale,
  executive_memorandum: Award, joint_memorandum: Users, moa: ScrollText, mou: FileSignature,
  executive_correspondence: Star, navmc_10274: ClipboardList, navmc_118_11: ClipboardList,
};
const GROUP_ICONS: Record<string, LucideIcon> = { correspondence: FileText, forms: ClipboardList };
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Letters: FileText, Endorsements: CheckCircle2, Memoranda: FileText,
  Agreements: ScrollText, Executive: Star, Forms: ClipboardList,
};

function DocIcon({ id, className }: { id: string; className?: string }) {
  const Icon = DOC_TYPE_ICONS[id] ?? FileText;
  return <Icon className={className ?? 'h-5 w-5 shrink-0 text-muted-foreground'} aria-hidden="true" />;
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useTourStore } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import type { TourStep } from '@/components/tour/tourSteps';
import { DOCUMENT_TYPE_GUIDES, GUIDE_CATEGORIES, GUIDE_GROUPS, type DocumentTypeGuide } from '@/data/documentGuide';
import { EXAMPLE_DOCUMENTS, EXAMPLE_CATEGORIES, type ExampleDocument } from '@/data/exampleDocuments';
import { DOC_TYPE_LABELS, type DocumentData } from '@/types/document';

import {
  getNextQuestion,
  getRecommendations,
  DOC_DIFFERENTIATORS,
  splitReason,
} from './documentFinderLogic';

// Document Finder Component
//
// A branching interview driven by getNextQuestion(answers). Answers are kept in
// an ordered stack so "Back" pops the last answer and re-derives the current
// question — questions are skipped/added dynamically, so a fixed index won't do.
function DocumentFinder({ onSelectGuide }: { onSelectGuide: (guideId: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[]>([]);

  const question = getNextQuestion(answers);
  const showResults = question === null && order.length > 0;

  const recommendations = useMemo(
    () => (showResults ? getRecommendations(answers) : []),
    [showResults, answers]
  );

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setOrder((prev) => [...prev, questionId]);
  };

  const handleBack = () => {
    if (order.length === 0) return;
    const last = order[order.length - 1];
    const nextAnswers = { ...answers };
    delete nextAnswers[last];
    setAnswers(nextAnswers);
    setOrder(order.slice(0, -1));
  };

  const handleReset = () => {
    setAnswers({});
    setOrder([]);
  };

  if (showResults) {
    const wasUnsure = ['category', 'recipient', 'purpose', 'resources', 'formType'].some(
      (k) => answers[k] === 'unsure'
    );
    const [a, b] = recommendations;
    const showCompare = b && DOC_DIFFERENTIATORS[a.docType] && DOC_DIFFERENTIATORS[b.docType];

    return (
      <div className="p-4 space-y-4">
        <div className="text-center pb-4 border-b">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/10 text-success mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg">Recommended Document Types</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Based on your answers, here are the best options
          </p>
        </div>

        {wasUnsure && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              You weren&apos;t sure on one or more answers, so these are the most common
              formats for your situation. Open any card to see when it fits, or use
              &ldquo;Start over&rdquo; to refine your answers.
            </span>
          </div>
        )}

        <div className="space-y-3">
          {recommendations.map((rec, index) => {
            const guide = DOCUMENT_TYPE_GUIDES.find(g => g.id === rec.docType);
            if (!guide) return null;
            const { cite, why } = splitReason(rec.reason);

            return (
              <button
                key={rec.docType}
                onClick={() => onSelectGuide(rec.docType)}
                className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full text-left p-4 rounded-lg border transition-all hover:border-primary hover:bg-accent/50 ${
                  index === 0 ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <DocIcon id={guide.id} className="h-6 w-6 shrink-0 text-primary mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{guide.name}</span>
                      {index === 0 ? (
                        <Badge className="bg-success/10 text-success border-success/30">
                          Best Match
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Alternative
                        </Badge>
                      )}
                      {cite && (
                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                          {cite}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{why}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </button>
            );
          })}
        </div>

        {showCompare && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Scale className="h-3.5 w-3.5" />
              How to choose
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[a, b].map((r) => {
                const g = DOCUMENT_TYPE_GUIDES.find((x) => x.id === r.docType);
                return (
                  <div key={r.docType} className="space-y-0.5">
                    <div className="text-sm font-medium">{g?.name ?? r.docType}</div>
                    <div className="text-xs text-muted-foreground">{DOC_DIFFERENTIATORS[r.docType]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-4 border-t">
          <Button variant="outline" onClick={handleReset} className="w-full">
            <RotateCcw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="p-4 space-y-6">
      <div className="text-xs font-medium text-muted-foreground">
        Question {order.length + 1}
      </div>

      {/* Question */}
      <div className="text-center py-2">
        <h3 className="text-lg font-semibold">{question.question}</h3>
        {question.help && (
          <p className="text-sm text-muted-foreground mt-1.5">{question.help}</p>
        )}
      </div>

      {/* Options */}
      <div className="space-y-2">
        {question.options.map((option) => (
          <button
            key={option.value}
            onClick={() => handleAnswer(question.id, option.value)}
            className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full text-left p-4 rounded-lg border hover:border-primary hover:bg-accent/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{option.label}</div>
                {option.help && (
                  <div className="text-xs text-muted-foreground mt-0.5">{option.help}</div>
                )}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          </button>
        ))}
      </div>

      {/* Back / Start over */}
      {order.length > 0 && (
        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Start over
          </Button>
        </div>
      )}
    </div>
  );
}

function GuideCard({ guide, isExpanded, onToggle }: {
  guide: DocumentTypeGuide;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border rounded-lg overflow-hidden bg-card transition-all">
      <button
        onClick={onToggle}
        className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full text-left p-4 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <DocIcon id={guide.id} className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{guide.name}</span>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {guide.summary}
            </p>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t bg-muted/30">
          <div className="pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <Lightbulb className="h-4 w-4" />
              When to Use
            </div>
            <ul className="space-y-1.5">
              {guide.whenToUse.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <FileText className="h-4 w-4" />
              Key Features
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guide.keyFeatures.map((feature, i) => (
                <Badge key={i} variant="secondary" className="text-xs font-normal">
                  {feature}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <BookOpen className="h-4 w-4" />
              Common Examples
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guide.commonExamples.map((example, i) => (
                <span
                  key={i}
                  className="text-xs bg-background border rounded-full px-2.5 py-1 text-muted-foreground"
                >
                  {example}
                </span>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              Reference: {guide.reference}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Examples Tab Component
function ExamplesTab({ onClose }: { onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState<ExampleDocument | null>(null);

  const filteredExamples = useMemo(() => {
    return EXAMPLE_DOCUMENTS.filter((example) => {
      const matchesSearch = !searchQuery ||
        example.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        example.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        example.docType.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory = !selectedCategory || example.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const handleLoadExample = () => {
    if (!selectedExample) return;

    const store = useDocumentStore.getState();

    // Set document type
    store.setDocType(selectedExample.docType);

    // Set form data fields
    Object.entries(selectedExample.formData).forEach(([key, value]) => {
      store.setField(key as keyof DocumentData, value);
    });

    // Clear existing paragraphs by removing from the end
    const currentParagraphCount = store.paragraphs.length;
    for (let i = currentParagraphCount - 1; i >= 0; i--) {
      store.removeParagraph(i);
    }

    // Add example paragraphs
    selectedExample.paragraphs.forEach((para) => {
      store.addParagraph(para.text, para.level);
    });

    // Clear existing references by removing from the end
    const currentRefCount = store.references.length;
    for (let i = currentRefCount - 1; i >= 0; i--) {
      store.removeReference(i);
    }

    // Add example references
    if (selectedExample.references) {
      selectedExample.references.forEach((ref) => {
        store.addReference(ref.title, ref.url);
      });
    }

    // Clear existing enclosures
    const currentEnclCount = store.enclosures.length;
    for (let i = currentEnclCount - 1; i >= 0; i--) {
      store.removeEnclosure(i);
    }

    // Clear existing copy-tos
    const currentCopyToCount = store.copyTos.length;
    for (let i = currentCopyToCount - 1; i >= 0; i--) {
      store.removeCopyTo(i);
    }

    // Add example copy-tos
    if (selectedExample.copyTos) {
      selectedExample.copyTos.forEach((copyTo) => {
        store.addCopyTo(copyTo.text);
      });
    }

    // Close modal
    onClose();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-4 border-b shrink-0 space-y-3 bg-background">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search examples..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category filters */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={selectedCategory === null ? 'default' : 'outline'}
            className="cursor-pointer hover:bg-primary/80"
            onClick={() => setSelectedCategory(null)}
          >
            All ({EXAMPLE_DOCUMENTS.length})
          </Badge>
          {EXAMPLE_CATEGORIES.map(({ category }) => {
            const count = EXAMPLE_DOCUMENTS.filter(e => e.category === category).length;
            return (
              <Badge
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                className="cursor-pointer hover:bg-primary/80"
                onClick={() => setSelectedCategory(category)}
              >
                {category} ({count})
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 grid gap-2">
          {filteredExamples.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No examples found matching your search.
            </div>
          ) : (
            filteredExamples.map((example) => (
              <button
                key={example.id}
                onClick={() => setSelectedExample(example)}
                className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedExample?.id === example.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-accent/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{example.name}</span>
                      {selectedExample?.id === example.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {example.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {example.category}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {DOC_TYPE_LABELS[example.docType] || example.docType}
                      </Badge>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {selectedExample && (
        <div className="p-4 border-t bg-muted/50 shrink-0 space-y-3">
          <div className="text-sm">
            <span className="font-medium">Selected:</span>{' '}
            <span className="text-muted-foreground">{selectedExample.name}</span>
          </div>
          <Button onClick={handleLoadExample} className="w-full">
            <Eye className="h-4 w-4 mr-2" />
            Load This Example
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            This will replace your current document with the example content.
          </p>
        </div>
      )}
    </div>
  );
}

// The power features that are easy to miss. Shown in the guide's "Features"
// tab: a one-line summary, quick numbered steps for people who learn fast, and
// a guided walkthrough that points at the real controls in the live UI.
interface PowerFeature {
  /** Stable onboarding key — marks this feature learned once its walkthrough finishes. */
  key: string;
  icon: LucideIcon;
  title: string;
  where: string;
  body: string;
  steps: string[];
  /** Guided walkthrough launched by "Walk me through it": one or more spotlight
   *  steps that can open the feature's surface and point at each control. */
  tour: TourStep[];
}

const openBatch = () => useUIStore.getState().setBatchModalOpen(true);
const closeBatch = () => useUIStore.getState().setBatchModalOpen(false);
const openProfileModal = () => useUIStore.getState().setProfileModalOpen(true);
const closeProfileModal = () => useUIStore.getState().setProfileModalOpen(false);
const openShareModal = () => useUIStore.getState().setShareModal('share');
const closeShareModal = () => useUIStore.getState().setShareModal(null);
const openTemplateLoader = () => useUIStore.getState().setTemplateLoaderOpen(true);
const closeTemplateLoader = () => useUIStore.getState().setTemplateLoaderOpen(false);
// The Save dropdown is store-controlled (Header refuses dismissals while a tour
// runs), so a walkthrough can hold it open and spotlight the items inside it.
const openSaveMenu = () => useUIStore.getState().setSaveMenuOpen(true);
const closeSaveMenu = () => useUIStore.getState().setSaveMenuOpen(false);

// Expand an inline accordion section (Enclosures, etc.) so a guided step can
// spotlight a control inside it. Clicks the section trigger only when it is
// currently collapsed, so re-running the step on Back never toggles it shut.
const expandSection = (tourKey: string) => {
  const item = document
    .querySelector(`[data-tour="${tourKey}"]`)
    ?.querySelector('[data-slot="accordion-item"]');
  if (item?.getAttribute('data-state') === 'closed') {
    (item.querySelector('[data-slot="accordion-trigger"]') as HTMLElement | null)?.click();
  }
};

const POWER_FEATURES: PowerFeature[] = [
  {
    key: 'batch',
    icon: Layers,
    title: 'Batch generation',
    where: 'Toolbar → Batch',
    body: 'Produce one finished document per row from a single template: award citations, promotion letters, or anything repeated across people.',
    steps: [
      'Open Batch from the toolbar.',
      'Drop a {{NAME}} placeholder (any label) into a field.',
      'Paste tab-separated rows straight from a spreadsheet.',
      'Map columns to placeholders, then review each row.',
      'Generate the set: one PDF per row.',
    ],
    tour: [
      {
        target: '[data-tour="batch"]',
        title: 'Open Batch',
        body: 'Batch lives on the toolbar. It turns one template into many finished documents.',
        action: closeBatch,
      },
      {
        target: '[data-tour="batch-addvar"]',
        title: 'Add a variable',
        body: 'Pick a variable and a field, then Add. That drops a {{placeholder}} into your document. DonDocs fills that column for every row.',
        action: openBatch,
      },
      {
        target: '[data-tour="batch-commonvars"]',
        title: 'Or copy a common one',
        body: 'Not sure what to use? These common variables copy with one click. Paste one into any field.',
        action: openBatch,
      },
      {
        target: '[data-tour="batch-generate"]',
        title: 'Generate the set',
        body: 'Paste your rows from a spreadsheet (each row becomes a document), then Generate makes one PDF per row.',
        action: openBatch,
      },
    ],
  },
  {
    key: 'profiles',
    icon: Users,
    title: 'Profiles',
    where: 'Top-left selector',
    body: 'Save your unit letterhead and sender details once, then reuse or switch between commands without retyping.',
    steps: [
      'Fill in your letterhead and sender details once.',
      'Click the + by the profile selector to save them as a profile.',
      'Switch profiles anytime from the dropdown; edit with the pencil.',
    ],
    tour: [
      {
        target: '[data-tour="profile-create"]',
        title: 'Create a profile',
        body: 'Profiles save your letterhead and sender details so you never retype them. Start one with the + button.',
        action: closeProfileModal,
      },
      {
        target: '[data-tour="profile-name"]',
        title: 'Name it',
        body: 'Give the profile a name you will recognize, like your command.',
        action: openProfileModal,
      },
      {
        target: '[data-tour="profile-letterhead"]',
        title: 'Fill the letterhead once',
        body: 'Your unit lines, address, and SSIC. Browse Units autofills these from the directory.',
        action: openProfileModal,
      },
      {
        target: '[data-tour="profile-signature"]',
        title: 'Add your signature block',
        body: 'Name, rank or title, and position. They carry into every document you draft with this profile.',
        action: openProfileModal,
      },
      {
        target: '[data-tour="profile-save"]',
        title: 'Save and reuse',
        body: 'Create the profile, then switch to it anytime from the selector. The pencil edits it later.',
        action: openProfileModal,
      },
    ],
  },
  {
    key: 'templates',
    icon: FolderOpen,
    title: 'Templates',
    where: 'Next to document type',
    body: 'Start from a ready-made document for common formats instead of a blank page.',
    steps: [
      'Pick your document type.',
      'Click Templates, then search or filter the list.',
      'Select one and load it. Your profile letterhead stays on top.',
    ],
    tour: [
      {
        target: '[data-tour="templates"]',
        title: 'Open Templates',
        body: 'Pick a document type, then open Templates to start from a ready-made document instead of a blank page.',
        action: closeTemplateLoader,
      },
      {
        target: '[data-tour="template-search"]',
        title: 'Find one',
        body: 'Search by name, description, or SSIC, or filter by category, then click a template to preview it.',
        action: openTemplateLoader,
      },
      {
        target: '[data-tour="template-load"]',
        title: 'Load it',
        body: 'Loads the subject, paragraphs, and references into the editor. Your profile letterhead stays on top.',
        action: openTemplateLoader,
      },
    ],
  },
  {
    key: 'enclosures',
    icon: Paperclip,
    title: 'Enclosures',
    where: 'Enclosures section',
    body: 'Attach PDF enclosures. They are listed on the letter and merged into the final PDF automatically.',
    steps: [
      'Open the Enclosures section and click Add enclosure.',
      'Title it, and optionally attach a PDF (drag and drop works).',
      'Attached PDFs merge into the export, in order, after the letter.',
    ],
    tour: [
      {
        target: '[data-tour="enclosures"] [data-slot="accordion-trigger"]',
        title: 'Enclosures',
        body: 'Where you list enclosures on the letter and attach PDF files.',
      },
      {
        target: '[data-tour="enclosure-add"]',
        title: 'Add an enclosure',
        body: 'Click Add enclosure and give it a title. It is listed on the letter automatically.',
        action: () => expandSection('enclosures'),
      },
      {
        target: '[data-tour="enclosure-attach"]',
        title: 'Attach a PDF',
        body: 'Optionally attach a PDF (drag and drop works). It merges into the final export, after the letter.',
        action: () => expandSection('enclosures'),
      },
    ],
  },
  {
    key: 'signature',
    icon: PenLine,
    title: 'Signature',
    where: 'Signature section',
    body: 'Add a signature block, an optional signature image, or a digital signature field on the exported PDF.',
    steps: [
      'Open Signature Block and fill name, rank/title, and office code.',
      'Choose a style: Typed only, Upload image, or Digital field.',
      'Optionally check "By direction" and set the authority.',
    ],
    tour: [
      {
        target: '[data-tour="signature"] [data-slot="accordion-trigger"]',
        title: 'Signature block',
        body: 'How your letter is signed: typed name, an image, or a digital field.',
      },
      {
        target: '[data-tour="signature-name"]',
        title: 'Who is signing',
        body: 'Fill in the name, then rank or title and position below. They print under the signature line.',
        action: () => expandSection('signature'),
      },
      {
        target: '[data-tour="signature-style"]',
        title: 'Pick a signature style',
        body: 'Three styles: Typed only, Upload image (a scanned signature), or Digital field for CAC/PKI signing in Adobe after you download.',
        action: () => expandSection('signature'),
      },
    ],
  },
  {
    key: 'share',
    icon: Link2,
    title: 'Encrypted share link',
    where: 'Save → Create share link',
    body: 'Send a document as a password-protected link. Nothing is stored on a server; the recipient needs both the link and the password you set.',
    steps: [
      'Open Save → Create share link and set a password.',
      'Generate the link. It copies to your clipboard.',
      'Send the link and password separately to the recipient.',
      'They open it with Save → Open from share link.',
    ],
    tour: [
      {
        target: '[data-tour="save"]',
        title: 'Share starts here',
        body: 'Open the Save menu, then Create share link, to send a password-protected copy.',
        action: closeShareModal,
      },
      {
        target: '[data-tour="share-password"]',
        title: 'Set a password',
        body: 'The document is encrypted in your browser. Nothing is stored on a server, and the recipient needs this password to open it.',
        action: openShareModal,
      },
      {
        target: '[data-tour="share-generate"]',
        title: 'Generate the link',
        body: 'Creates a link that copies to your clipboard. Send the link and the password separately; the recipient opens it with Save → Open from share link.',
        action: openShareModal,
      },
    ],
  },
  {
    key: 'classification',
    icon: Shield,
    title: 'Classification & portion marks',
    where: 'Classification section',
    body: 'Set the document classification and per-paragraph portion marks. The banner is derived from the highest marking in the document.',
    steps: [
      'Open the Classification section and set the classification level.',
      'Fill the marking fields that appear (CUI or classified).',
      'Set per-paragraph portion marks in the body editor.',
      'The banner is derived from the highest marking.',
    ],
    tour: [
      {
        target: '[data-tour="classification"] [data-slot="accordion-trigger"]',
        title: 'Classification',
        body: 'Set the document marking and the banner that appears at the top.',
      },
      {
        target: '[data-tour="classification-level"]',
        title: 'Set the level',
        body: 'Choose the classification. The right marking fields (CUI or classified) appear below, and the banner is derived from the highest marking. Per-paragraph portion marks live in the body editor.',
        action: () => expandSection('classification'),
      },
    ],
  },
  {
    key: 'backup',
    icon: FolderSync,
    title: 'Back up everything',
    where: 'Save → Back up everything',
    body: 'One file with your entire account — documents, profiles, signatures, snippets, templates, form fields, and enclosure attachments. Restore it on any machine; nothing ever touches a server.',
    steps: [
      'Open Save → Back up everything to download the backup file.',
      'Keep it somewhere safe — a shared drive, USB stick, or synced folder.',
      'On a new machine, use Save → Restore from backup to bring it all back.',
      'On desktop Chrome or Edge, Set up auto-backup keeps a file current after every save.',
    ],
    tour: [
      {
        target: '[data-tour="save"]',
        title: 'Your safety net',
        body: 'Everything lives in this browser — so keep a copy outside it. All the backup tools are in this Save menu.',
        action: closeSaveMenu,
      },
      {
        target: '[data-tour="backup-export"]',
        title: 'Back up everything',
        body: 'Downloads one file with your whole account — documents, profiles, signatures, snippets, templates, form fields, and enclosure attachments. Keep it on a shared drive, USB stick, or synced folder.',
        action: openSaveMenu,
      },
      {
        target: '[data-tour="backup-restore"]',
        title: 'Restore anywhere',
        body: 'Merges a backup file back in — on this machine or a brand-new one — without overwriting anything newer.',
        action: openSaveMenu,
      },
      {
        target: '[data-tour="backup-auto"]',
        title: 'Set it and forget it',
        body: 'On desktop Chrome or Edge, auto-backup mirrors your account to a file of your choosing after every save — drop it in a synced folder and it is always current.',
        action: openSaveMenu,
      },
    ],
  },
];

export function DocumentGuideModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const documentGuideOpen = useUIStore((s) => s.documentGuideOpen);
  const setDocumentGuideOpen = useUIStore((s) => s.setDocumentGuideOpen);
  // The active tab lives in the store so the activation checklist can deep-link
  // straight to Features (it sets the tab, then opens the guide).
  const activeTab = useUIStore((s) => s.documentGuideTab);
  const setActiveTab = useUIStore((s) => s.setDocumentGuideTab);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const completed = useOnboardingStore((s) => s.completed);
  const learnedCount = POWER_FEATURES.filter((f) => completed[f.key]).length;

  // "Show me": close the guide, then run the feature's guided walkthrough once
  // the dialog has finished animating out so the page is interactive again.
  // The key marks the feature learned when its walkthrough reaches the end.
  const handleShowMe = (tour: TourStep[], key: string) => {
    setDocumentGuideOpen(false);
    window.setTimeout(() => {
      useTourStore.getState().startSteps(tour, key);
    }, 300);
  };

  // Get categories for selected group
  const groupCategories = useMemo(() => {
    if (!selectedGroup) return [];
    return GUIDE_CATEGORIES.filter(cat => cat.group === selectedGroup);
  }, [selectedGroup]);

  const filteredGuides = useMemo(() => {
    if (!selectedGroup) return [];
    if (!selectedCategory) {
      // Show all guides for the selected group
      const groupCategoryIds = groupCategories.map(c => c.id);
      return DOCUMENT_TYPE_GUIDES.filter(guide => groupCategoryIds.includes(guide.category));
    }
    return DOCUMENT_TYPE_GUIDES.filter(guide => guide.category === selectedCategory);
  }, [selectedGroup, selectedCategory, groupCategories]);

  const handleToggleGuide = (guideId: string) => {
    setExpandedGuide(expandedGuide === guideId ? null : guideId);
  };

  const handleSelectFromFinder = (guideId: string) => {
    // Find the guide and its category/group
    const guide = DOCUMENT_TYPE_GUIDES.find(g => g.id === guideId);
    if (guide) {
      const category = GUIDE_CATEGORIES.find(c => c.id === guide.category);
      if (category) {
        setSelectedGroup(category.group);
      }
    }
    setActiveTab('browse');
    setSelectedCategory(null);
    setExpandedGuide(guideId);
    // Scroll to the guide after a short delay
    setTimeout(() => {
      const element = document.getElementById(`guide-${guideId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  return (
    <Dialog open={documentGuideOpen} onOpenChange={setDocumentGuideOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Document Guide
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Find the right document type, learn about formats, or load an example
          </p>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="px-4 py-2 border-b bg-muted/30 shrink-0">
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setActiveTab('browse')}
              className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'browse' || activeTab === 'finder'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Search className="h-4 w-4" />
              <span>Browse</span>
            </button>
            <button
              onClick={() => setActiveTab('examples')}
              className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'examples'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Examples</span>
              <span className="sm:hidden">Examples</span>
            </button>
            <button
              onClick={() => setActiveTab('features')}
              className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'features'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="h-4 w-4" />
              <span className="hidden sm:inline">Features</span>
              <span className="sm:hidden">More</span>
            </button>
          </div>
        </div>

        {activeTab === 'finder' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex items-center gap-1.5 px-4 pt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to browse
            </button>
            <DocumentFinder onSelectGuide={handleSelectFromFinder} />
          </div>
        )}

        {activeTab === 'features' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-6 space-y-2.5">
              <p className="text-sm text-muted-foreground">
                DonDocs does more than draft a single letter. Expand a feature for the quick steps, or pick “Walk me through it” for a guided tour of the real controls.
              </p>
              <div className="rounded-lg border bg-card/50 px-3.5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {learnedCount} of {POWER_FEATURES.length} features learned
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {learnedCount === POWER_FEATURES.length ? 'All caught up' : 'Keep going'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-success transition-all duration-300"
                    style={{ width: `${(learnedCount / POWER_FEATURES.length) * 100}%` }}
                  />
                </div>
              </div>
              {POWER_FEATURES.map((f) => {
                const Icon = f.icon;
                const isOpen = expandedFeature === f.title;
                const isLearned = !!completed[f.key];
                return (
                  <div key={f.title} className="rounded-lg border bg-card/50 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedFeature(isOpen ? null : f.title)}
                      aria-expanded={isOpen}
                      className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full flex items-start gap-2.5 p-3 text-left hover:bg-muted/40 transition-colors"
                    >
                      {isLearned ? (
                        <span
                          className="flex-none mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success"
                          aria-label="Learned"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span
                          className="flex-none mt-0.5 h-5 w-5 rounded-full border-2 border-muted-foreground/25"
                          aria-hidden="true"
                        />
                      )}
                      <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-sm">{f.title}</h4>
                          <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">{f.where}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{f.body}</p>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pl-11">
                        <ol className="space-y-2">
                          {f.steps.map((step, i) => (
                            <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                              <span className="flex-none w-5 h-5 rounded-full border text-xs flex items-center justify-center text-foreground mt-px">
                                {i + 1}
                              </span>
                              <span className="leading-snug">{step}</span>
                            </li>
                          ))}
                        </ol>
                        <button
                          type="button"
                          onClick={() => handleShowMe(f.tour, f.key)}
                          className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          {f.tour.length > 1 ? 'Walk me through it' : 'Show me where'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'browse' && (
          <>
            {/* Group selection - show first if no group selected */}
            {!selectedGroup ? (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="p-6 space-y-4">
                  <div className="text-center pb-4">
                    <h3 className="font-semibold text-lg">What are you looking for?</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Choose a category to browse available types
                    </p>
                  </div>
                  <div className="grid gap-4">
                    {GUIDE_GROUPS.map((group) => {
                      const groupCats = GUIDE_CATEGORIES.filter(c => c.group === group.id);
                      const count = DOCUMENT_TYPE_GUIDES.filter(g =>
                        groupCats.some(c => c.id === g.category)
                      ).length;
                      return (
                        <button
                          key={group.id}
                          onClick={() => {
                            setSelectedGroup(group.id);
                            setSelectedCategory(null);
                            setExpandedGuide(null);
                          }}
                          className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 w-full text-left p-6 rounded-lg border-2 hover:border-primary hover:bg-accent/50 transition-all group"
                        >
                          <div className="flex items-center gap-4">
                            {(() => { const GI = GROUP_ICONS[group.id] ?? FileText; return <GI className="h-8 w-8 shrink-0 text-primary" aria-hidden="true" />; })()}
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xl font-semibold">{group.name}</span>
                                <Badge variant="secondary">{count} types</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {group.description}
                              </p>
                            </div>
                            <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('finder')}
                      className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                      Not sure which to use? Answer a few questions
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Back button and category filters */}
                <div className="px-4 py-3 border-b bg-muted/30 shrink-0 space-y-3">
                  <button
                    onClick={() => {
                      setSelectedGroup(null);
                      setSelectedCategory(null);
                      setExpandedGuide(null);
                    }}
                    className="focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className="h-4 w-4 rotate-180" />
                    Back to categories
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setSelectedCategory(null);
                        setExpandedGuide(null);
                      }}
                      className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        selectedCategory === null
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border hover:bg-accent'
                      }`}
                    >
                      All {GUIDE_GROUPS.find(g => g.id === selectedGroup)?.name}
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                        {filteredGuides.length}
                      </Badge>
                    </button>
                    {groupCategories.map((cat) => {
                      const count = DOCUMENT_TYPE_GUIDES.filter(g => g.category === cat.id).length;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            setSelectedCategory(cat.id);
                            setExpandedGuide(null);
                          }}
                          className={`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            selectedCategory === cat.id
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background border hover:bg-accent'
                          }`}
                        >
                          {(() => { const CI = CATEGORY_ICONS[cat.id] ?? FileText; return <CI className="h-3.5 w-3.5" aria-hidden="true" />; })()}
                          {cat.name}
                          <Badge
                            variant={selectedCategory === cat.id ? 'outline' : 'secondary'}
                            className={`ml-1 h-5 px-1.5 text-xs ${selectedCategory === cat.id ? 'border-primary-foreground/30' : ''}`}
                          >
                            {count}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Guide list */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="p-4 space-y-3">
                    {selectedCategory && (
                      <div className="pb-2 mb-2 border-b">
                        <div className="flex items-center gap-2">
                          {(() => { const CI = CATEGORY_ICONS[selectedCategory] ?? FileText; return <CI className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />; })()}
                          <div>
                            <h3 className="font-semibold">{GUIDE_CATEGORIES.find(c => c.id === selectedCategory)?.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {GUIDE_CATEGORIES.find(c => c.id === selectedCategory)?.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {filteredGuides.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No document types found in this category.
                      </div>
                    ) : (
                      filteredGuides.map((guide) => (
                        <div key={guide.id} id={`guide-${guide.id}`}>
                          <GuideCard
                            guide={guide}
                            isExpanded={expandedGuide === guide.id}
                            onToggle={() => handleToggleGuide(guide.id)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'examples' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <ExamplesTab onClose={() => setDocumentGuideOpen(false)} />
          </div>
        )}

        {/* Footer with tip - only show on finder and browse tabs */}
        {activeTab !== 'examples' && (
          <div className="px-4 py-3 border-t bg-muted/30 shrink-0">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                <strong className="text-foreground">Tip:</strong> When in doubt, the Naval Letter format is appropriate for most official correspondence. Use Business Letter format only for external civilian recipients.
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
