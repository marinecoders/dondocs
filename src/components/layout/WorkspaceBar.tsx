import { useState } from 'react';
import { List, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProfileBar } from '@/components/editor/ProfileBar';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from './editorSections';

/** Section navigation is separate from the workspace document library. */
export function WorkspaceBar({ activeSection }: { activeSection: string }) {
  const { sections, isFormsMode } = useEditorSections();
  const [profileOpen, setProfileOpen] = useState(false);
  const showOutline = useUIStore((s) => s.sidebarOutlineVisible);
  const mobile = useUIStore((s) => s.isMobile);
  return <div className="shrink-0">
    <div className="flex items-center gap-2 px-4 sm:px-5 pt-6 pb-2">
      <label htmlFor="workspace-section" className="text-xs text-muted-foreground">Contents</label>
      <select id="workspace-section" aria-label="Document section" value={activeSection}
        onChange={(event) => useEditorOutlineStore.getState().jump(event.target.value)}
        className="h-10 sm:h-8 min-w-0 max-w-[65%] rounded-md border border-border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
        {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
      </select>
      {!mobile && <Button variant="ghost" size="icon-sm" aria-label={showOutline ? 'Hide contents outline' : 'Show contents outline'} aria-pressed={showOutline} onClick={() => useUIStore.getState().toggleSidebarOutline()}><List className="h-3.5 w-3.5" /></Button>}
      <div className="flex-1" />
      {!isFormsMode && <Button variant="ghost" size="sm" className="h-10 sm:h-8 px-2 text-xs" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><UserRound className="h-3.5 w-3.5" />Profile</Button>}
    </div>
    {!isFormsMode && profileOpen && <div className="px-3 sm:px-5 pb-2"><ProfileBar /></div>}
  </div>;
}
