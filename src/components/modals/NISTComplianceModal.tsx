import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, Server, Lock, Wifi, Eye, Database, ExternalLink } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

export function NISTComplianceModal() {
  const { nistModalOpen, setNistModalOpen } = useUIStore();

  return (
    <Dialog open={nistModalOpen} onOpenChange={setNistModalOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-500" />
            NIST 800-171 Compliance
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-5">
            <section className="space-y-2">
              <h4 className="font-semibold">What is NIST 800-171?</h4>
              <p className="text-sm text-muted-foreground">
                NIST Special Publication 800-171 provides guidelines for protecting Controlled Unclassified Information (CUI) in non-federal systems. It's required for DoD contractors and anyone handling sensitive government information.
              </p>
            </section>

            <section className="space-y-3">
              <h4 className="font-semibold">How This Application Complies</h4>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Server className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">No Server Communication</p>
                    <p className="text-xs text-muted-foreground">
                      All document processing happens entirely in your browser. No data is ever transmitted to any server.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Lock className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Local Processing Only</p>
                    <p className="text-xs text-muted-foreground">
                      LaTeX compilation, PDF generation, and enclosure merging all run locally using WebAssembly technology.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Wifi className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Air-Gap Compatible</p>
                    <p className="text-xs text-muted-foreground">
                      Works on isolated networks (SIPR, JWICS) without any internet connectivity required.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Eye className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">No Telemetry or Analytics</p>
                    <p className="text-xs text-muted-foreground">
                      Zero tracking, no cookies, no analytics. Your documents and usage patterns are completely private.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Database className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Browser-Only Storage</p>
                    <p className="text-xs text-muted-foreground">
                      Saved profiles and drafts are stored in your browser's localStorage. Clearing your browser data removes everything.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="font-semibold">Suitable For</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• CUI (Controlled Unclassified Information)</li>
                <li>• FOUO (For Official Use Only)</li>
                <li>• Sensitive but unclassified documents</li>
                <li>• Documents processed on government networks</li>
              </ul>
            </section>

            <section className="space-y-2 pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                For official NIST 800-171 documentation, visit:{' '}
                <a
                  href="https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  NIST SP 800-171 Rev. 2
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
