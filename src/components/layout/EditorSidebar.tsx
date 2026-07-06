import { useMemo, useState, useRef, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, MoreHorizontal, Copy, Pencil, Undo2, History, Pin, PinOff, ArrowDownAZ, Clock, CheckSquare, Check, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconTip } from '@/components/ui/icon-tip';
import { SectionRail } from './SectionRail';
import { getSectionError, getFormSectionError, useEditorSections, ERROR_BEARING_IDS } from './editorSections';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentsStore, searchableText, type DocumentMeta } from '@/stores/documentsStore';
import { docTypeChip } from '@/types/document';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

type RecentsSort = 'recent' | 'name';

const byRecent = (a: DocumentMeta, b: DocumentMeta) => b.updatedAt - a.updatedAt;
const byName = (a: DocumentMeta, b: DocumentMeta) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

function groupByRecency(metas: DocumentMeta[]): { label: string; items: DocumentMeta[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const buckets: Record<string, DocumentMeta[]> = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] };
  for (const m of metas) {
    if (m.updatedAt >= today) buckets.Today.push(m);
    else if (m.updatedAt >= yesterday) buckets.Yesterday.push(m);
    else if (m.updatedAt >= week) buckets['Previous 7 days'].push(m);
    else buckets.Older.push(m);
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// Pinned docs always float to their own group on top; the rest follow the active
// sort — grouped by recency ("recent") or one flat A–Z list ("name").
function buildGroups(metas: DocumentMeta[], sort: RecentsSort): { label: string; items: DocumentMeta[] }[] {
  const cmp = sort === 'name' ? byName : byRecent;
  const pinned = metas.filter((m) => m.pinned).sort(cmp);
  const rest = metas.filter((m) => !m.pinned);
  const groups: { label: string; items: DocumentMeta[] }[] = [];
  if (pinned.length) groups.push({ label: 'Pinned', items: pinned });
  if (sort === 'name') {
    const sorted = [...rest].sort(byName);
    if (sorted.length) groups.push({ label: 'All documents', items: sorted });
  } else {
    groups.push(...groupByRecency([...rest].sort(byRecent)));
  }
  return groups;
}

/**
 * The editor's left sidebar (desktop only). Two stacked zones:
 *   On this page: the current document's section outline, fixed on top.
 *   Recent: the document library, grouped by recency, scrolling beneath.
 */
export function EditorSidebar() {
  const isMobile = useUIStore((s) => s.isMobile);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const validationVisible = useUIStore((s) => s.validationVisible);

  // ── Section outline (top) ──────────────────────────────────────────────────
  const { sections, config, isFormsMode, formType } = useEditorSections();

  const activeId = useEditorOutlineStore((s) => s.activeId);
  const jump = useEditorOutlineStore((s) => s.jump);
  const effectiveActive = sections.some((s) => s.id === activeId) ? activeId : sections[0]?.id ?? null;

  // Error dots: primitive selectors so typing only re-renders the sidebar when
  // a required field crosses a threshold, and never before export.
  const docErrorSignature = useDocumentStore((s) =>
    !validationVisible || isFormsMode
      ? ''
      : ERROR_BEARING_IDS.filter((id) => getSectionError(id, s.formData, s.paragraphs, config)).join(',')
  );
  const formErrorSignature = useFormStore((s) => {
    if (!validationVisible || !isFormsMode) return '';
    const data = formType === 'navmc_10274' ? s.navmc10274 : formType === 'navmc_118_11' ? s.navmc11811 : null;
    if (!data) return '';
    return sections.filter((sec) => getFormSectionError(formType, sec.id, data)).join(',');
  });
  const errorSignature = isFormsMode ? formErrorSignature : docErrorSignature;
  const errorIds = useMemo(() => {
    if (!errorSignature) return new Set<string>();
    const flagged = new Set(errorSignature.split(','));
    return new Set(sections.filter((s) => flagged.has(s.id)).map((s) => s.id));
  }, [errorSignature, sections]);

  // ── Recents (bottom) ───────────────────────────────────────────────────────
  const docs = useDocumentsStore((s) => s.docs);
  const currentId = useDocumentsStore((s) => s.currentId);
  const newDocument = useDocumentsStore((s) => s.newDocument);
  const switchTo = useDocumentsStore((s) => s.switchTo);
  const remove = useDocumentsStore((s) => s.remove);
  const hydrated = useDocumentsStore((s) => s.hydrated);
  const removeMany = useDocumentsStore((s) => s.removeMany);
  const togglePin = useDocumentsStore((s) => s.togglePin);
  const pendingDelete = useDocumentsStore((s) => s.pendingDelete);
  const restoreDeleted = useDocumentsStore((s) => s.restoreDeleted);
  const renameDocument = useDocumentsStore((s) => s.renameDocument);
  const duplicateDocument = useDocumentsStore((s) => s.duplicateDocument);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RecentsSort>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  const announceSeq = useRef(0);
  const navRef = useRef<HTMLElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Re-render once a minute so relative timestamps ("just now" → "1m ago") stay
  // fresh on their own, without depending on an unrelated state change.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const commitRename = (id: string) => {
    renameDocument(id, renameValue);
    setRenamingId(null);
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Full-text: match the whole document (subject, recipient, routing, SSIC,
    // body, headings, refs/encls), not just the title.
    const metas = Object.values(docs)
      .filter((d) => (q ? searchableText(d).includes(q) : true))
      .map((d) => d.meta);
    return buildGroups(metas, sort);
  }, [docs, query, sort]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return exitSelectMode();
    removeMany(ids);
    setAnnounce(`Removed ${ids.length} document${ids.length === 1 ? '' : 's'}`);
    exitSelectMode();
  };

  const handleDelete = (m: DocumentMeta) => {
    // No confirm dialog: remove() is a SOFT delete and the "Removed — Undo"
    // banner gives a recovery window, so an accidental delete is reversible.
    // Pick a focus target next to the removed row so keyboard focus doesn't fall
    // back to <body> when the row unmounts; fall back to the New button.
    const order = groups.flatMap((g) => g.items.map((it) => it.id));
    const idx = order.indexOf(m.id);
    const nextId = order[idx + 1] ?? order[idx - 1] ?? null;
    remove(m.id);
    // Append an alternating zero-width space (8203, not spoken) so deleting two
    // same-titled drafts (blank drafts share a title) still changes the
    // live-region text and re-announces.
    const zwsp = String.fromCharCode(8203).repeat(announceSeq.current++ % 2);
    setAnnounce(`Removed ${m.title}${zwsp}`);
    setTimeout(() => {
      const target = nextId
        ? navRef.current?.querySelector<HTMLElement>(`[data-doc-id="${nextId}"]`)
        : newBtnRef.current;
      target?.focus();
    }, 0);
  };

  if (isMobile) return null;

  if (collapsed) {
    return (
      <nav
        aria-label="Documents"
        className="hidden sm:flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-2"
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Expand sidebar" title="Expand sidebar"
          aria-expanded={false}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={newDocument}
          aria-label="New document" title="New document"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </nav>
    );
  }

  return (
    <nav
      ref={navRef}
      aria-label="Documents"
      className="hidden sm:flex w-[248px] shrink-0 flex-col border-r border-border bg-muted/30"
    >
      <span aria-live="polite" className="sr-only">{announce}</span>

      {/* On this page: section outline (collapse control shares the label row) */}
      <div className="px-2 pb-2 border-b border-border">
        <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
          <span className="text-2xs font-semibold tracking-[0.06em] uppercase text-muted-foreground">
            On this page
          </span>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar" title="Collapse sidebar"
            aria-expanded={true}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        {sections.length > 1 && (
          <SectionRail sections={sections} activeId={effectiveActive} errorIds={errorIds} onJump={jump} />
        )}
      </div>

      {/* Recent: document library */}
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <div className="flex items-center justify-between px-3 pb-1.5">
          <span className="text-2xs font-semibold tracking-[0.06em] uppercase text-muted-foreground">Recent</span>
          <div className="flex items-center gap-1">
            <IconTip label={sort === 'recent' ? 'Sorted by most recent — switch to A–Z' : 'Sorted A–Z — switch to most recent'}>
              <button
                type="button"
                onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))}
                aria-label={sort === 'recent' ? 'Sort by name' : 'Sort by most recent'}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
              >
                {sort === 'recent' ? <Clock className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
              </button>
            </IconTip>
            <IconTip label={selectMode ? 'Exit selection' : 'Select multiple documents'}>
              <button
                type="button"
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                aria-pressed={selectMode}
                aria-label={selectMode ? 'Exit selection' : 'Select multiple documents'}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors ${
                  selectMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <CheckSquare className="h-3.5 w-3.5" />
              </button>
            </IconTip>
            <button
              ref={newBtnRef}
              type="button"
              onClick={newDocument}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>

        {selectMode ? (
          <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {selected.size === 0 ? 'Select documents' : `${selected.size} selected`}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={deleteSelected}
                disabled={selected.size === 0}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <button
                type="button"
                onClick={exitSelectMode}
                aria-label="Cancel selection"
                className="inline-flex items-center rounded px-1 py-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-2 pb-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents"
                aria-label="Search documents"
                className="w-full border-none bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
        )}

        {pendingDelete && (
          <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Removed <span className="text-foreground">{pendingDelete.title}</span>
            </span>
            <button
              type="button"
              onClick={() => restoreDeleted()}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!hydrated ? (
            <ul className="space-y-0.5" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-2 w-1/3 animate-pulse rounded bg-muted/70" />
                  </div>
                </li>
              ))}
            </ul>
          ) : groups.length === 0 ? (
            query ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">No matching documents.</p>
            ) : (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">Nothing here yet — start your first document.</p>
                <div className="mt-3 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={newDocument}
                    className="rounded-md px-2.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    Start a naval letter
                  </button>
                  <button
                    type="button"
                    onClick={() => useUIStore.getState().setTemplateLoaderOpen(true)}
                    className="rounded-md px-2.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    Browse templates
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      useUIStore.getState().setDocumentGuideTab('finder');
                      useUIStore.getState().setDocumentGuideOpen(true);
                    }}
                    className="rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    Not sure which? Answer a few questions
                  </button>
                </div>
              </div>
            )
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-1.5">
                <div className="px-2.5 py-1 text-2xs font-semibold tracking-[0.06em] uppercase text-muted-foreground">{g.label}</div>
                <ul className="space-y-0.5">
                  {g.items.map((m) => {
                    const active = m.id === currentId;
                    const isSelected = selected.has(m.id);
                    return (
                      <li
                        key={m.id}
                        className={`group relative flex items-center rounded-md pr-1 transition-colors ${
                          // Active (non-select) already shows the 3px scarlet bar +
                          // text-primary like the section rail above, so no row fill
                          // here — the fill is reserved for the selection-checked state.
                          selectMode && isSelected ? 'bg-primary/10' : 'hover:bg-muted/60'
                        }`}
                      >
                        {active && !selectMode && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-primary"
                          />
                        )}
                        {selectMode ? (
                          /* Selection mode: the whole row toggles a checkbox. Uses a
                             plain span (not the Radix Checkbox) so we don't nest a
                             button inside this button. */
                          <button
                            type="button"
                            data-doc-id={m.id}
                            onClick={() => toggleSelected(m.id)}
                            aria-pressed={isSelected}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </span>
                            <span title={m.title} className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {m.title}
                            </span>
                            {m.pinned && <Pin className="h-3 w-3 shrink-0 text-primary/70" aria-label="Pinned" />}
                          </button>
                        ) : renamingId === m.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(m.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(m.id);
                              else if (e.key === 'Escape') setRenamingId(null);
                            }}
                            aria-label={`Rename ${m.title}`}
                            className="min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          />
                        ) : (
                          /* Open the document; sibling to the actions menu, not nested. */
                          <button
                            type="button"
                            data-doc-id={m.id}
                            onClick={() => switchTo(m.id)}
                            aria-current={active ? 'true' : undefined}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            <span
                              aria-hidden="true"
                              className={`inline-flex h-4 shrink-0 items-center justify-center rounded px-1 text-2xs font-semibold uppercase leading-none tracking-wide ${
                                active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                              }`}
                              style={{ minWidth: '2.4rem' }}
                            >
                              {docTypeChip(m.docType)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span
                                title={m.title}
                                className={`block truncate text-sm ${active ? 'text-primary' : 'text-foreground'}`}
                              >
                                {m.title}
                              </span>
                              <span className="block whitespace-nowrap text-2xs text-muted-foreground tnum">
                                {relTime(m.updatedAt)}
                              </span>
                            </span>
                            {m.pinned && <Pin className="h-3 w-3 shrink-0 text-primary/70" aria-label="Pinned" />}
                          </button>
                        )}
                        {/* Row actions: pin / rename / duplicate / version / delete.
                            Hidden in selection mode; revealed on hover/focus otherwise. */}
                        {!selectMode && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Actions for ${m.title}`}
                                // Rest at 40% (not fully hidden) and reveal on
                                // row-level hover/focus so tabbing doesn't pop each
                                // '…' 0→100 in turn; always shown on touch (no hover).
                                className="shrink-0 rounded p-1 text-muted-foreground opacity-40 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onSelect={() => togglePin(m.id)}>
                                {m.pinned ? (
                                  <><PinOff className="h-3.5 w-3.5" /> Unpin</>
                                ) : (
                                  <><Pin className="h-3.5 w-3.5" /> Pin</>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setRenameValue(m.name ?? m.title);
                                  setRenamingId(m.id);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => duplicateDocument(m.id)}>
                                <Copy className="h-3.5 w-3.5" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  switchTo(m.id);
                                  useUIStore.getState().setHistoryDocId(m.id);
                                }}
                              >
                                <History className="h-3.5 w-3.5" /> Version history
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => handleDelete(m)}
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </nav>
  );
}
