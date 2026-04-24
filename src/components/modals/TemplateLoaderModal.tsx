import { useState, useMemo } from 'react';
import { FileText, FolderOpen, Search, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useProfileStore } from '@/stores/profileStore';
import { LETTER_TEMPLATES, type LetterTemplate } from '@/data/templates';

const CATEGORIES = [...new Set(LETTER_TEMPLATES.map(t => t.category))];

export function TemplateLoaderModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const templateLoaderOpen = useUIStore((s) => s.templateLoaderOpen);
  const setTemplateLoaderOpen = useUIStore((s) => s.setTemplateLoaderOpen);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplate | null>(null);

  const filteredTemplates = useMemo(() => {
    return LETTER_TEMPLATES.filter((template) => {
      const matchesSearch = !searchQuery ||
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (template.ssic && template.ssic.includes(searchQuery));

      const matchesCategory = !selectedCategory || template.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const handleLoadTemplate = () => {
    if (!selectedTemplate) return;

    const store = useDocumentStore.getState();

    // Set document type
    store.setDocType(selectedTemplate.docType);

    // Set subject
    if (selectedTemplate.subject) {
      store.setField('subject', selectedTemplate.subject);
    }

    // Set SSIC if available
    if (selectedTemplate.ssic) {
      store.setField('ssic', selectedTemplate.ssic);
    }

    // Clear existing paragraphs by removing from the end (avoids index shifting issues)
    const currentParagraphCount = store.paragraphs.length;
    for (let i = currentParagraphCount - 1; i >= 0; i--) {
      store.removeParagraph(i);
    }

    // Add template paragraphs
    selectedTemplate.paragraphs.forEach((para) => {
      store.addParagraph(para.text, para.level);
    });

    // Clear existing references by removing from the end
    const currentRefCount = store.references.length;
    for (let i = currentRefCount - 1; i >= 0; i--) {
      store.removeReference(i);
    }

    // Add template references
    if (selectedTemplate.references) {
      selectedTemplate.references.forEach((ref) => {
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

    // Apply selected profile on top of template (profile always wins)
    const profileStore = useProfileStore.getState();
    const { selectedProfile, profiles } = profileStore;
    if (selectedProfile && profiles[selectedProfile]) {
      const profile = profiles[selectedProfile];
      store.setFormData({
        department: profile.department,
        unitLine1: profile.unitLine1,
        unitLine2: profile.unitLine2,
        unitAddress: profile.unitAddress,
        ssic: profile.ssic,
        from: profile.from,
        sigFirst: profile.sigFirst,
        sigMiddle: profile.sigMiddle,
        sigLast: profile.sigLast,
        sigRank: profile.sigRank,
        sigTitle: profile.sigTitle,
        byDirection: profile.byDirection,
        byDirectionAuthority: profile.byDirectionAuthority,
        cuiControlledBy: profile.cuiControlledBy,
        pocEmail: profile.pocEmail,
        signatureImage: profile.signatureImage,
      });
    }

    // Close modal and reset state
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  const handleClose = () => {
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  return (
    <Dialog open={templateLoaderOpen} onOpenChange={setTemplateLoaderOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-6 py-4 border-b shrink-0 z-10">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Load Template
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {LETTER_TEMPLATES.length} templates
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 border-b shrink-0 space-y-3 bg-background z-10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates by name, description, or SSIC..."
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
              All
            </Badge>
            {CATEGORIES.map((category) => (
              <Badge
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                className="cursor-pointer hover:bg-primary/80"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 grid gap-2">
            {filteredTemplates.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No templates found matching your search.
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{template.name}</span>
                        {selectedTemplate?.id === template.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {template.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {template.category}
                        </Badge>
                        {template.ssic && (
                          <Badge variant="outline" className="text-xs">
                            SSIC {template.ssic}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {template.paragraphs.length} para{template.paragraphs.length !== 1 ? 's' : ''}
                          {template.references && ` • ${template.references.length} ref${template.references.length !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedTemplate && (
          <div className="p-4 border-t bg-muted/50 shrink-0 z-10">
            <div className="text-sm">
              <span className="font-medium">Preview:</span>
              <p className="text-muted-foreground mt-1">
                {selectedTemplate.subject || '(No subject - endorsement)'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This will replace your current document content.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="bg-background px-6 py-4 border-t shrink-0 z-10">
          <Button
            variant="outline"
            onClick={handleClose}
            className="hover:bg-accent"
          >
            Cancel
          </Button>
          <Button
            onClick={handleLoadTemplate}
            disabled={!selectedTemplate}
            className="hover:bg-primary/90"
          >
            <FileText className="h-4 w-4 mr-2" />
            Load Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
