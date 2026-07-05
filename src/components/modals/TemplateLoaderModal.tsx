import { useState, useMemo } from 'react';
import { FileText, FolderOpen, Search, Check, Save, Trash2, Star } from 'lucide-react';
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
import { useDocumentStore, getSerializedSessionForShare, loadSharedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { showAppAlert } from '@/stores/alertStore';
import { useProfileStore } from '@/stores/profileStore';
import { LETTER_TEMPLATES, type LetterTemplate } from '@/data/templates';
import { DOC_TYPE_LABELS } from '@/types/document';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';

const CATEGORIES = [...new Set(LETTER_TEMPLATES.map(t => t.category))];

export function TemplateLoaderModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const templateLoaderOpen = useUIStore((s) => s.templateLoaderOpen);
  const setTemplateLoaderOpen = useUIStore((s) => s.setTemplateLoaderOpen);

  const userTemplates = useUserTemplatesStore((s) => s.templates);
  const saveTemplate = useUserTemplatesStore((s) => s.saveTemplate);
  const deleteTemplate = useUserTemplatesStore((s) => s.deleteTemplate);
  // A SerializedSession carries only correspondence content — NAVMC form fields
  // live in a separate store — so "save as template" while on a form would make
  // an empty, unloadable template. Only offer it for correspondence documents.
  const isForms = useDocumentStore((s) => s.documentCategory === 'forms');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplate | null>(null);
  // A user template is selected instead of a built-in (mutually exclusive).
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Non-null while the "Save current as template" name field is showing.
  const [savingName, setSavingName] = useState<string | null>(null);

  const userTemplateList = useMemo(
    () =>
      Object.values(userTemplates)
        .filter((t) =>
          !searchQuery ? true : t.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [userTemplates, searchQuery]
  );

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

    // Non-destructive: preserve the doc currently open in Recents before the
    // template overwrites the live store, then re-home the templated result as
    // its own new document. Loading a template no longer discards your work.
    useDocumentsStore.getState().syncCurrent();

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
        // Canonicalize on read (see App.tsx for rationale).
        unitAddress: canonicalizeUnitAddress(profile.unitAddress),
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

    // Re-home the templated document as its own new Recents entry (fresh id,
    // baseline, promoted) and reset validation, matching the load-draft flow.
    useDocumentsStore.getState().openLoadedAsNew();
    useUIStore.getState().setValidationVisible(false);

    // Close modal and reset state
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  // Load a user-saved template: restore its full session as a new document,
  // preserving the currently-open one (same non-destructive flow as built-ins).
  const loadUserTemplate = () => {
    const t = selectedUserId ? userTemplates[selectedUserId] : null;
    if (!t) return;
    useDocumentsStore.getState().syncCurrent();
    loadSharedSession(t.session);
    useDocumentsStore.getState().openLoadedAsNew();
    useUIStore.getState().setValidationVisible(false);
    handleClose();
  };

  const handleSaveTemplate = () => {
    if (savingName === null) return;
    if (useDocumentStore.getState().documentCategory === 'forms') return; // guarded below too
    // compressedLocalStorage rethrows on quota; zustand has already applied the
    // in-memory add, so warn rather than crash to the ErrorBoundary — and keep the
    // name field open so the user can retry after freeing space.
    try {
      saveTemplate(savingName, getSerializedSessionForShare());
      setSavingName(null);
    } catch (err) {
      console.error('Failed to save template (storage may be full)', err);
      showAppAlert({
        title: "Couldn't save this template",
        message:
          "Your browser's local storage is full. Delete a few documents or templates, then try again.",
      });
    }
  };

  const handleClose = () => {
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSelectedUserId(null);
    setSavingName(null);
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

        <div data-tour="template-search" className="p-4 border-b shrink-0 space-y-3 bg-background z-10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates by name, description, or SSIC…"
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

          {/* Save the open document as a reusable template — correspondence only. */}
          {isForms ? (
            <p className="text-xs text-muted-foreground">
              Templates capture correspondence. Switch to a letter or memo to save one.
            </p>
          ) : savingName === null ? (
            <Button variant="outline" size="sm" onClick={() => setSavingName('')}>
              <Star className="mr-1.5 h-3.5 w-3.5" /> Save current as template
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTemplate();
                  else if (e.key === 'Escape') setSavingName(null);
                }}
                placeholder="Template name…"
                className="flex-1"
              />
              <Button size="sm" onClick={handleSaveTemplate} disabled={!savingName.trim()}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSavingName(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 grid gap-2">
            {userTemplateList.length > 0 && (
              <>
                <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Your templates
                </div>
                {userTemplateList.map((t) => (
                  <div
                    key={t.id}
                    className={`group flex items-start gap-2 rounded-lg border p-4 transition-colors ${
                      selectedUserId === t.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUserId(t.id);
                        setSelectedTemplate(null);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none"
                    >
                      <Star className="mt-0.5 h-5 w-5 shrink-0 text-primary/70" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{t.name}</span>
                          {selectedUserId === t.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </div>
                        <div className="mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {DOC_TYPE_LABELS[t.docType] ?? t.docType}
                          </Badge>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteTemplate(t.id);
                        if (selectedUserId === t.id) setSelectedUserId(null);
                      }}
                      aria-label={`Delete ${t.name}`}
                      className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="mt-2 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Built-in templates
                </div>
              </>
            )}
            {filteredTemplates.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No templates found matching your search.
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setSelectedUserId(null);
                  }}
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

        {(selectedTemplate || selectedUserId) && (
          <div className="p-4 border-t bg-muted/50 shrink-0 z-10">
            <div className="text-sm">
              <span className="font-medium">Preview:</span>
              <p className="text-muted-foreground mt-1">
                {selectedTemplate
                  ? selectedTemplate.subject || '(No subject - endorsement)'
                  : (selectedUserId && userTemplates[selectedUserId]?.session.formData?.subject) ||
                    (selectedUserId ? userTemplates[selectedUserId]?.name : '')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Opens as a new document — your current one is kept in Recents.
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
            data-tour="template-load"
            onClick={selectedUserId ? loadUserTemplate : handleLoadTemplate}
            disabled={!selectedTemplate && !selectedUserId}
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
