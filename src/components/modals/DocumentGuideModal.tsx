import { useState, useMemo } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, FileText, CheckCircle2, Lightbulb, BookOpen, Sparkles, ArrowRight, RotateCcw, Search, Eye, Check } from 'lucide-react';
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
import { DOCUMENT_TYPE_GUIDES, GUIDE_CATEGORIES, type DocumentTypeGuide } from '@/data/documentGuide';
import { EXAMPLE_DOCUMENTS, EXAMPLE_CATEGORIES, type ExampleDocument } from '@/data/exampleDocuments';
import { DOC_TYPE_LABELS, type DocumentData } from '@/types/document';

// Document Finder Questions and Logic
interface Question {
  id: string;
  question: string;
  options: {
    label: string;
    value: string;
    icon?: string;
  }[];
}

const FINDER_QUESTIONS: Question[] = [
  {
    id: 'recipient',
    question: 'Who is the primary recipient?',
    options: [
      { label: 'Military command or unit', value: 'military', icon: '🎖️' },
      { label: 'Civilian person or business', value: 'civilian', icon: '💼' },
      { label: 'Multiple commands/addressees', value: 'multiple', icon: '📨' },
      { label: 'For the record (no specific recipient)', value: 'record', icon: '📔' },
    ],
  },
  {
    id: 'purpose',
    question: 'What is the main purpose?',
    options: [
      { label: 'Request, recommendation, or tasking', value: 'request', icon: '📋' },
      { label: 'Provide information or status update', value: 'inform', icon: '📢' },
      { label: 'Present options for a decision', value: 'decision', icon: '⚖️' },
      { label: 'Document an event for the record', value: 'document', icon: '📝' },
      { label: 'Establish an agreement between parties', value: 'agreement', icon: '🤝' },
      { label: 'Endorse/forward another letter', value: 'response', icon: '↩️' },
    ],
  },
  {
    id: 'routing',
    question: 'How will this be routed?',
    options: [
      { label: 'Direct to recipient', value: 'direct', icon: '➡️' },
      { label: 'Through chain of command (via)', value: 'via', icon: '⬆️' },
      { label: 'Internal within my command', value: 'internal', icon: '🏢' },
    ],
  },
  {
    id: 'formality',
    question: 'What level of formality is needed?',
    options: [
      { label: 'Formal with official letterhead', value: 'formal', icon: '🏛️' },
      { label: 'Routine/working level', value: 'informal', icon: '📄' },
      { label: 'Flag/General officer level', value: 'executive', icon: '⭐' },
    ],
  },
];

interface FinderResult {
  docType: string;
  confidence: 'high' | 'medium';
  reason: string;
}

function getRecommendations(answers: Record<string, string>): FinderResult[] {
  const results: FinderResult[] = [];
  const { recipient, purpose, routing, formality } = answers;

  // ===========================================
  // ENDORSEMENTS (Ch 7) - Responding to/forwarding another letter
  // ===========================================
  if (purpose === 'response') {
    if (formality === 'informal' || routing === 'internal') {
      results.push({
        docType: 'same_page_endorsement',
        confidence: 'high',
        reason: 'Per Ch 7: Brief endorsements added directly below the basic letter when space permits',
      });
      results.push({
        docType: 'new_page_endorsement',
        confidence: 'medium',
        reason: 'Use if endorsement is lengthy or basic letter page is full',
      });
    } else {
      results.push({
        docType: 'new_page_endorsement',
        confidence: 'high',
        reason: 'Per Ch 7: New page endorsement with own letterhead for formal/detailed responses',
      });
      results.push({
        docType: 'same_page_endorsement',
        confidence: 'medium',
        reason: 'Alternative if endorsement is brief and fits on original letter',
      });
    }
    return results;
  }

  // ===========================================
  // AGREEMENTS (Ch 12) - MOA vs MOU
  // MOA = Specific resource/funding commitments
  // MOU = General understanding, roles, coordination
  // ===========================================
  if (purpose === 'agreement') {
    if (formality === 'formal' || formality === 'executive') {
      results.push({
        docType: 'moa',
        confidence: 'high',
        reason: 'Per Ch 12: MOA for agreements with specific resource commitments, funding, or binding obligations',
      });
      results.push({
        docType: 'mou',
        confidence: 'medium',
        reason: 'Alternative: MOU if establishing general understanding without specific resource commitments',
      });
    } else {
      results.push({
        docType: 'mou',
        confidence: 'high',
        reason: 'Per Ch 12: MOU for establishing working relationships and general coordination frameworks',
      });
      results.push({
        docType: 'moa',
        confidence: 'medium',
        reason: 'Use MOA instead if agreement involves specific resources or funding',
      });
    }
    return results;
  }

  // ===========================================
  // FOR THE RECORD - MFR (Ch 10)
  // ===========================================
  if (recipient === 'record') {
    results.push({
      docType: 'mfr',
      confidence: 'high',
      reason: 'Per Ch 10: Memorandum for the Record documents events, decisions, or conversations for official record',
    });
    return results;
  }

  // ===========================================
  // CIVILIAN RECIPIENTS - Business Letter (Ch 11)
  // ===========================================
  if (recipient === 'civilian') {
    results.push({
      docType: 'business_letter',
      confidence: 'high',
      reason: 'Per Ch 11: Business letter format for correspondence with civilians, contractors, and non-DoD entities',
    });
    return results;
  }

  // ===========================================
  // DECISION MEMOS (Ch 12) - Presenting options
  // ===========================================
  if (purpose === 'decision') {
    results.push({
      docType: 'decision_memorandum',
      confidence: 'high',
      reason: 'Per Ch 12: Decision memo presents options with pros/cons and staff recommendation for command decision',
    });
    if (formality === 'executive') {
      results.push({
        docType: 'executive_memorandum',
        confidence: 'medium',
        reason: 'Alternative for flag/general officer level with executive summary format',
      });
    }
    return results;
  }

  // ===========================================
  // MULTIPLE ADDRESSEES (Ch 2)
  // ===========================================
  if (recipient === 'multiple') {
    results.push({
      docType: 'multiple_address_letter',
      confidence: 'high',
      reason: 'Per Ch 2: Multiple address letter for identical content to several commands simultaneously',
    });
    results.push({
      docType: 'naval_letter',
      confidence: 'medium',
      reason: 'Alternative: Standard naval letter with distribution list in Copy To section',
    });
    return results;
  }

  // ===========================================
  // EXECUTIVE/FLAG LEVEL (Ch 12)
  // ===========================================
  if (formality === 'executive') {
    if (routing === 'internal' || purpose === 'inform') {
      results.push({
        docType: 'executive_memorandum',
        confidence: 'high',
        reason: 'Per Ch 12: Executive memo for staff-to-senior leadership communication, status updates, and briefings',
      });
    } else {
      results.push({
        docType: 'executive_correspondence',
        confidence: 'high',
        reason: 'Per Ch 12: Executive correspondence for flag-to-flag or communication with very senior officials',
      });
    }
    results.push({
      docType: 'naval_letter',
      confidence: 'medium',
      reason: 'Naval letter is also appropriate for formal executive matters requiring official record',
    });
    return results;
  }

  // ===========================================
  // DOCUMENTING EVENTS (Ch 10)
  // ===========================================
  if (purpose === 'document') {
    results.push({
      docType: 'mfr',
      confidence: 'high',
      reason: 'Per Ch 10: MFR documents meetings, verbal orders, decisions, or events for the official record',
    });
    if (routing === 'internal') {
      results.push({
        docType: 'letterhead_memorandum',
        confidence: 'medium',
        reason: 'Alternative: Letterhead memo if document needs to be shared formally within command',
      });
    }
    return results;
  }

  // ===========================================
  // INTERNAL/ROUTINE COMMUNICATION (Ch 12)
  // ===========================================
  if (routing === 'internal') {
    if (formality === 'informal') {
      results.push({
        docType: 'plain_paper_memorandum',
        confidence: 'high',
        reason: 'Per Ch 12: Plain paper memo for routine internal working-level communication',
      });
      results.push({
        docType: 'mf',
        confidence: 'medium',
        reason: 'Alternative: "Memorandum For" format for direct communication to specific person/office',
      });
    } else {
      results.push({
        docType: 'letterhead_memorandum',
        confidence: 'high',
        reason: 'Per Ch 12: Letterhead memo for formal internal communications that may be forwarded',
      });
      results.push({
        docType: 'mf',
        confidence: 'medium',
        reason: 'Alternative: "Memorandum For" for direct staff actions or information papers',
      });
    }
    return results;
  }

  // ===========================================
  // CHAIN OF COMMAND ROUTING (Ch 2)
  // ===========================================
  if (routing === 'via') {
    results.push({
      docType: 'naval_letter',
      confidence: 'high',
      reason: 'Per Ch 2: Naval letter with Via line for correspondence routed through chain of command',
    });
    if (formality === 'informal') {
      results.push({
        docType: 'standard_letter',
        confidence: 'medium',
        reason: 'Alternative: Standard letter (same format without letterhead) if letterhead not available',
      });
    }
    return results;
  }

  // ===========================================
  // DEFAULT - NAVAL LETTER (Ch 2)
  // The standard format for official DoN correspondence
  // ===========================================
  if (formality === 'formal') {
    results.push({
      docType: 'naval_letter',
      confidence: 'high',
      reason: 'Per Ch 2: Naval letter is the standard format for official Department of the Navy correspondence',
    });
  } else {
    results.push({
      docType: 'naval_letter',
      confidence: 'high',
      reason: 'Per Ch 2: Naval letter is appropriate for most official military correspondence',
    });
    results.push({
      docType: 'standard_letter',
      confidence: 'medium',
      reason: 'Alternative: Standard letter (same format) when letterhead is not required or available',
    });
  }

  return results;
}

// Document Finder Component
function DocumentFinder({ onSelectGuide }: { onSelectGuide: (guideId: string) => void }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showResults, setShowResults] = useState(false);

  const handleAnswer = (questionId: string, value: string) => {
    const newAnswers = { ...answers, [questionId]: value };
    setAnswers(newAnswers);

    // Move to next question or show results
    if (currentQuestion < FINDER_QUESTIONS.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      setShowResults(true);
    }
  };

  const handleReset = () => {
    setCurrentQuestion(0);
    setAnswers({});
    setShowResults(false);
  };

  const recommendations = useMemo(() => {
    if (!showResults) return [];
    return getRecommendations(answers);
  }, [showResults, answers]);

  const question = FINDER_QUESTIONS[currentQuestion];
  const progress = ((currentQuestion + (showResults ? 1 : 0)) / FINDER_QUESTIONS.length) * 100;

  if (showResults) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center pb-4 border-b">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 text-green-500 mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg">Recommended Document Types</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Based on your answers, here are the best options
          </p>
        </div>

        <div className="space-y-3">
          {recommendations.map((rec, index) => {
            const guide = DOCUMENT_TYPE_GUIDES.find(g => g.id === rec.docType);
            if (!guide) return null;

            return (
              <button
                key={rec.docType}
                onClick={() => onSelectGuide(rec.docType)}
                className={`w-full text-left p-4 rounded-lg border transition-all hover:border-primary hover:bg-accent/50 ${
                  index === 0 ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{guide.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{guide.name}</span>
                      {rec.confidence === 'high' && index === 0 && (
                        <Badge className="bg-green-500/10 text-green-600 border-green-500/30">
                          Best Match
                        </Badge>
                      )}
                      {rec.confidence === 'medium' && (
                        <Badge variant="outline" className="text-xs">
                          Alternative
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {rec.reason}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="pt-4 border-t">
          <Button variant="outline" onClick={handleReset} className="w-full">
            <RotateCcw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Question {currentQuestion + 1} of {FINDER_QUESTIONS.length}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="text-center py-4">
        <h3 className="text-lg font-semibold">{question.question}</h3>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {question.options.map((option) => (
          <button
            key={option.value}
            onClick={() => handleAnswer(question.id, option.value)}
            className="w-full text-left p-4 rounded-lg border hover:border-primary hover:bg-accent/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{option.icon}</span>
              <span className="flex-1 font-medium">{option.label}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>

      {/* Back / Reset */}
      {currentQuestion > 0 && (
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const prevQuestion = FINDER_QUESTIONS[currentQuestion - 1];
              const newAnswers = { ...answers };
              delete newAnswers[prevQuestion.id];
              setAnswers(newAnswers);
              setCurrentQuestion(currentQuestion - 1);
            }}
          >
            Back to previous question
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
        className="w-full text-left p-4 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">{guide.icon}</span>
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
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
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
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
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

export function DocumentGuideModal() {
  const { documentGuideOpen, setDocumentGuideOpen } = useUIStore();
  const [activeTab, setActiveTab] = useState<'finder' | 'browse' | 'examples'>('finder');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);

  const filteredGuides = useMemo(() => {
    if (!selectedCategory) return DOCUMENT_TYPE_GUIDES;
    return DOCUMENT_TYPE_GUIDES.filter(guide => guide.category === selectedCategory);
  }, [selectedCategory]);

  const handleToggleGuide = (guideId: string) => {
    setExpandedGuide(expandedGuide === guideId ? null : guideId);
  };

  const handleSelectFromFinder = (guideId: string) => {
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
              onClick={() => setActiveTab('finder')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'finder'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">Find My Doc</span>
              <span className="sm:hidden">Find</span>
            </button>
            <button
              onClick={() => setActiveTab('browse')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'browse'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Browse Types</span>
              <span className="sm:hidden">Browse</span>
            </button>
            <button
              onClick={() => setActiveTab('examples')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'examples'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Examples</span>
              <span className="sm:hidden">Examples</span>
            </button>
          </div>
        </div>

        {activeTab === 'finder' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DocumentFinder onSelectGuide={handleSelectFromFinder} />
          </div>
        )}

        {activeTab === 'browse' && (
          <>
            {/* Category filters */}
            <div className="px-4 py-3 border-b bg-muted/30 shrink-0">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setSelectedCategory(null);
                    setExpandedGuide(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedCategory === null
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background border hover:bg-accent'
                  }`}
                >
                  All Types
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {DOCUMENT_TYPE_GUIDES.length}
                  </Badge>
                </button>
                {GUIDE_CATEGORIES.map((cat) => {
                  const count = DOCUMENT_TYPE_GUIDES.filter(g => g.category === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        setExpandedGuide(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        selectedCategory === cat.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border hover:bg-accent'
                      }`}
                    >
                      <span>{cat.icon}</span>
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
                      <span className="text-xl">
                        {GUIDE_CATEGORIES.find(c => c.id === selectedCategory)?.icon}
                      </span>
                      <div>
                        <h3 className="font-semibold">{selectedCategory}</h3>
                        <p className="text-sm text-muted-foreground">
                          {GUIDE_CATEGORIES.find(c => c.id === selectedCategory)?.description}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {filteredGuides.map((guide) => (
                  <div key={guide.id} id={`guide-${guide.id}`}>
                    <GuideCard
                      guide={guide}
                      isExpanded={expandedGuide === guide.id}
                      onToggle={() => handleToggleGuide(guide.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
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
