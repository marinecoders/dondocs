import { useRef } from 'react';
import { List, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from './editorSections';

export function WorkspaceBar({ activeSection }: { activeSection: string }) {
  const { sections } = useEditorSections();
  const layout = useUIStore((s) => s.editorLayout);
  const mobile = useUIStore((s) => s.isMobile);
  const showOutline = useUIStore((s) => s.sidebarOutlineVisible && !s.sidebarCollapsed);
  const pendingJump = useRef<string | null>(null);
  const active = sections.find((section) => section.id === activeSection);
  return <div className="workspace-contents flex shrink-0 items-center gap-2 px-4 sm:px-5 pt-3 pb-2">
    {sections.length === 0 ? <span className="text-xs text-muted-foreground">Form sections</span> : showOutline && !mobile ? <span className="truncate text-xs text-muted-foreground">{active?.label}</span> : layout === 'focused' ? <select aria-label="Document section" value={activeSection}
      onChange={(event) => useEditorOutlineStore.getState().jump(event.target.value)}
      className="h-11 sm:h-9 min-w-0 max-w-[70%] rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
    </select> :
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 sm:h-9 px-2 text-sm"><List className="h-4 w-4" />Contents<ChevronDown className="h-3 w-3 text-muted-foreground" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-[65dvh] overflow-y-auto" onCloseAutoFocus={(event) => {
          const id = pendingJump.current;
          if (id) { event.preventDefault(); pendingJump.current = null; useEditorOutlineStore.getState().jump(id); }
        }}>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Jump to section</DropdownMenuLabel>
          {sections.map((section) => <DropdownMenuItem key={section.id} aria-current={activeSection === section.id ? 'location' : undefined}
            className="min-h-11 sm:min-h-9 aria-[current=location]:bg-accent" onSelect={() => { pendingJump.current = section.id; }}>
            {section.icon && <section.icon className="h-4 w-4" />}{section.label}
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>}
    <div className="flex-1" />
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="Editor view" className="h-11 sm:h-9 px-2 text-sm"><SlidersHorizontal className="h-4 w-4" />View<ChevronDown className="h-3 w-3 text-muted-foreground" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Editor layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={layout} onValueChange={(value) => useUIStore.getState().setEditorLayout(value === 'scroll' ? 'scroll' : 'focused')}>
          <DropdownMenuRadioItem value="scroll" className="min-h-14"><span><span className="block">Full document</span><span className="block text-xs text-muted-foreground">Scroll through every section</span></span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="focused" className="min-h-14"><span><span className="block">One section</span><span className="block text-xs text-muted-foreground">Edit only the section you choose</span></span></DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {!mobile && <><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={showOutline} className="min-h-11" onCheckedChange={(checked) => {
          const ui = useUIStore.getState();
          if (checked && ui.sidebarCollapsed) ui.toggleSidebar();
          if (ui.sidebarOutlineVisible !== checked) ui.toggleSidebarOutline();
        }}>Keep contents in sidebar</DropdownMenuCheckboxItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
