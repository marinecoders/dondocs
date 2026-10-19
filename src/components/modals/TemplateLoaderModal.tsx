import { useState, useMemo } from 'react';
import { FileText, FolderOpen, Search, Check, Save, Trash2, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { getSerializedSessionForShare, loadSharedSession } from '@/stores/documentStore';
import { useDocumentsStore, profileFormPatch } from '@/stores/documentsStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { showAppAlert } from '@/stores/alertStore';
import { useProfileStore } from '@/stores/profileStore';
import { LETTER_TEMPLATES, type LetterTemplate } from '@/data/templates';
import { DOC_TYPE_LABELS, FORM_TYPE_LABELS } from '@/types/document';
import { templateSession } from '@/lib/templateSession';
import { SessionPreview } from '@/components/SessionPreview';
import { sessionSearchFields, matchesSearch } from '@/lib/workspaceSearch';

const CATEGORIES = [...new Set(LETTER_TEMPLATES.map(t => t.category))];

export function TemplateLoaderModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const templateLoaderOpen = useUIStore((s) => s.templateLoaderOpen);
  const setTemplateLoaderOpen = useUIStore((s) => s.setTemplateLoaderOpen);

  const userTemplates = useUserTemplatesStore((s) => s.templates);
  const saveTemplate = useUserTemplatesStore((s) => s.saveTemplate);
  const deleteTemplate = useUserTemplatesStore((s) => s.deleteTemplate);
  const searchQuery = useUIStore((s) => s.templateSearch);
  const setSearchQuery = useUIStore((s) => s.setTemplateSearch);
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
          matchesSearch([t.name, ...sessionSearchFields(t.session).map((f) => f.text)].join(' '), searchQuery)
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

    useDocumentsStore.getState().syncCurrent();
    loadSharedSession(selectedSession!);
    useDocumentsStore.getState().openLoadedAsNew();
    useUIStore.getState().setValidationVisible(false);
    handleClose();
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

  const profiles = useProfileStore((s) => s.profiles);
  const selectedProfile = useProfileStore((s) => s.selectedProfile);
  const selectedSession = selectedUserId ? userTemplates[selectedUserId]?.session
    : selectedTemplate ? templateSession(selectedTemplate, selectedProfile && profiles[selectedProfile] ? profileFormPatch(profiles[selectedProfile]) : {}) : null;

  return (
    <Dialog open={templateLoaderOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl h-[85dvh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-4 py-3 pr-14 border-b shrink-0 text-left">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Load template
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {LETTER_TEMPLATES.length} templates
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">Choose a template to open as a new document.</DialogDescription>
        </DialogHeader>

        <div data-tour="template-search" className="p-4 border-b shrink-0 space-y-3 bg-background z-10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search templates"
              placeholder="Search templates by name, description, or SSIC…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <select aria-label="Template category" value={selectedCategory ?? ''}
            onChange={(event) => setSelectedCategory(event.target.value || null)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="border-b p-4 space-y-3">
          {savingName === null ? (
            <Button variant="ghost" size="sm" onClick={() => setSavingName('')}>
              <Star className="mr-1.5 h-3.5 w-3.5" /> Save current as template
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Saved templates keep text and typed names. Attached files and signature images are excluded.</p>
              <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Template name"
                autoFocus
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTemplate();
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSavingName(null); }
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
            </div>
          )}
        </div>

          {selectedSession && (
            <details key={selectedUserId ?? selectedTemplate?.id} className="border-b bg-muted/30 p-4 text-sm">
              <summary className="cursor-pointer font-medium">Preview: {selectedUserId ? userTemplates[selectedUserId]?.name : selectedTemplate?.name}</summary>
              <div className="mt-3"><SessionPreview session={selectedSession} /></div>
              <p className="mt-2 text-xs text-muted-foreground">Opens as a new document. Your current one stays in Recents.</p>
            </details>
          )}
          <div className="p-3 grid gap-2">
            {userTemplateList.length > 0 && (
              <>
                <div className="px-1 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Your templates
                </div>
                {userTemplateList.map((t) => (
                  <div
                    key={t.id}
                    className={`group flex items-start gap-2 rounded-md border p-3 transition-colors ${
                      selectedUserId === t.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selectedUserId === t.id}
                      onClick={() => {
                        setSelectedUserId(t.id);
                        setSelectedTemplate(null);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded text-left focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star className="mt-0.5 h-5 w-5 shrink-0 text-primary/70" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{t.name}</span>
                          {selectedUserId === t.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </div>
                        <div className="mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {t.session.genericForm?.definition.label ?? FORM_TYPE_LABELS[t.docType as keyof typeof FORM_TYPE_LABELS] ?? DOC_TYPE_LABELS[t.docType] ?? t.docType}
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
                      className="shrink-0 rounded p-2 text-muted-foreground hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="mt-2 px-1 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Built-in templates
                </div>
              </>
            )}
            {filteredTemplates.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No built-in templates match this search.
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  aria-pressed={selectedTemplate?.id === template.id}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setSelectedUserId(null);
                  }}
                  className={`w-full text-left p-3 rounded-md border transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{template.name}</span>
                        {selectedTemplate?.id === template.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {template.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
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

        <DialogFooter className="bg-background px-4 py-3 border-t shrink-0">
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
            Load template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
