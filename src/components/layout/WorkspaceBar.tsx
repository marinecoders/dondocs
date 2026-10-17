import { List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from './editorSections';

/** Section navigation is separate from the workspace document library. */
export function WorkspaceBar({ activeSection }: { activeSection: string }) {
  const { sections } = useEditorSections();
  const showOutline = useUIStore((s) => s.sidebarOutlineVisible);
  const layout = useUIStore((s) => s.editorLayout);
  const mobile = useUIStore((s) => s.isMobile);
  return <div className="shrink-0">
    <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pt-4 sm:pt-6 pb-2">
      <label htmlFor="workspace-section" className="hidden sm:inline text-xs text-muted-foreground">Contents</label>
      <select id="workspace-section" aria-label="Document section" value={activeSection}
        onChange={(event) => useEditorOutlineStore.getState().jump(event.target.value)}
        className="h-10 sm:h-8 min-w-0 flex-1 sm:flex-none sm:max-w-[65%] rounded-md border border-border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
        {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
      </select>
      {!mobile && <Button variant="ghost" size="icon-sm" aria-label={showOutline ? 'Hide contents outline' : 'Show contents outline'} aria-pressed={showOutline} onClick={() => useUIStore.getState().toggleSidebarOutline()}><List className="h-3.5 w-3.5" /></Button>}
      <div className="hidden sm:block flex-1" />
      <div role="group" aria-label="Editor layout" className="inline-flex shrink-0 rounded-md bg-muted p-0.5">
        {(['focused', 'scroll'] as const).map((mode) => <button key={mode} type="button"
          aria-pressed={layout === mode} aria-label={`${mode === 'focused' ? 'Focused' : 'Scroll'} mode`}
          title={mode === 'focused' ? 'Edit one section at a time' : 'Scroll through all sections'}
          onClick={() => useUIStore.getState().setEditorLayout(mode)}
          className="min-h-10 sm:min-h-7 rounded px-2 text-xs text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-ring">
          {mode === 'focused' ? 'Focused' : 'Scroll'}
        </button>)}
      </div>
    </div>
  </div>;
}
