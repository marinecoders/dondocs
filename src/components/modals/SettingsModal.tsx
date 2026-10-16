import { Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUIStore, type DensityMode } from '@/stores/uiStore';

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, theme, setTheme, density, setDensity, fullQualityPreview, setFullQualityPreview } = useUIStore();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Settings</DialogTitle><DialogDescription>Workspace preferences are saved on this device.</DialogDescription></DialogHeader>
    <label className="space-y-2 text-sm"><span className="block font-medium">Appearance</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <label className="space-y-2 text-sm"><span className="block font-medium">Density</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={density} onChange={(e) => setDensity(e.target.value as DensityMode)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
    <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={fullQualityPreview} onChange={(e) => setFullQualityPreview(e.target.checked)} /><span><span className="block font-medium">Full-quality preview</span><span className="text-muted-foreground">Include enclosures, hyperlinks and signatures. Larger documents take longer to render.</span></span></label>
  </DialogContent></Dialog>;
}
