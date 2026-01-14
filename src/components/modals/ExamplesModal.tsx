import { useState, useMemo } from 'react';
import { FileText, BookOpen, Search, Check, Eye } from 'lucide-react';
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
import { EXAMPLE_DOCUMENTS, EXAMPLE_CATEGORIES, type ExampleDocument } from '@/data/exampleDocuments';
import { DOC_TYPE_LABELS, type DocumentData } from '@/types/document';

export function ExamplesModal() {
  const { examplesModalOpen, setExamplesModalOpen } = useUIStore();

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

    // Clear existing paragraphs by removing from the end (avoids index shifting issues)
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

    // Close modal and reset state
    setExamplesModalOpen(false);
    setSelectedExample(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  const handleClose = () => {
    setExamplesModalOpen(false);
    setSelectedExample(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  return (
    <Dialog open={examplesModalOpen} onOpenChange={setExamplesModalOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-6 py-4 border-b shrink-0 z-10">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Example Documents
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {EXAMPLE_DOCUMENTS.length} examples
            </span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            View complete example documents to see what each document type looks like
          </p>
        </DialogHeader>

        <div className="p-4 border-b shrink-0 space-y-3 bg-background z-10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search examples by name or description..."
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
            {EXAMPLE_CATEGORIES.map(({ category }) => (
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
                        <span className="text-xs text-muted-foreground">
                          {example.paragraphs.length} para{example.paragraphs.length !== 1 ? 's' : ''}
                          {example.references.length > 0 && ` • ${example.references.length} ref${example.references.length !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedExample && (
          <div className="p-4 border-t bg-muted/50 shrink-0 z-10">
            <div className="text-sm space-y-2">
              <div>
                <span className="font-medium">Selected:</span>{' '}
                <span className="text-muted-foreground">{selectedExample.name}</span>
              </div>
              {selectedExample.formData.subject && (
                <div>
                  <span className="font-medium">Subject:</span>{' '}
                  <span className="text-muted-foreground">{String(selectedExample.formData.subject)}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Loading this example will replace your current document content. The example includes realistic fake content to demonstrate the document format.
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
            onClick={handleLoadExample}
            disabled={!selectedExample}
            className="hover:bg-primary/90"
          >
            <Eye className="h-4 w-4 mr-2" />
            Load Example
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
