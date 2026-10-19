import { Shield, Database, FileOutput, Globe, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUIStore } from '@/stores/uiStore';

const PRIVACY_DETAILS = [
  { icon: Shield, title: 'Document processing', text: 'Document generation, PDF merging, and letter imports run in your browser.' },
  { icon: Database, title: 'Storage on this device', text: 'Documents, history, and attachments use IndexedDB. Preferences, profiles, and other workspace settings also use localStorage. Clearing site data can remove your workspace; keep an external backup.' },
  { icon: FileOutput, title: 'Exports, backups, and sharing', text: 'Downloads and backups create files you control. Password-protected share links contain an encrypted document snapshot; anyone with the link and password can open it. Sharing excludes attached files and signature images.' },
  { icon: Globe, title: 'Network access', text: 'Loading or updating the app retrieves application assets. External help links open other sites, and the optional endpoint check contacts the address you provide. Local processing does not mean the browser makes no network requests.' },
];

export function NISTComplianceModal() {
  const open = useUIStore((s) => s.nistModalOpen);
  const setOpen = useUIStore((s) => s.setNistModalOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle>Privacy, storage & NIST 800-171</DialogTitle>
          <DialogDescription>How this workspace handles your information.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4 pr-1">
          <dl className="divide-y divide-border">
            {PRIVACY_DETAILS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-start gap-3 py-3 first:pt-0">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div><dt className="text-sm font-medium">{title}</dt><dd className="mt-1 text-sm text-muted-foreground">{text}</dd></div>
              </div>
            ))}
          </dl>
          <section className="border-t pt-4 text-sm space-y-2">
            <h3 className="font-medium">Authorization and compliance</h3>
            <p className="text-muted-foreground">These product features are not a NIST compliance certification or authorization to process sensitive information. Use an environment and workflow approved by your organization. A classification marking or a .mil address alone does not establish that approval.</p>
            <a href="https://csrc.nist.gov/pubs/sp/800/171/r3/final" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              NIST SP 800-171 <ExternalLink className="h-3.5 w-3.5" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
