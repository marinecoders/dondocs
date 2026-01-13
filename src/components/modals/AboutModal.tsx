import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Github, Shield, Zap, FileText, Lock, Plane, ExternalLink } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

const VERSION = '1.0.0';

export function AboutModal() {
  const { aboutModalOpen, setAboutModalOpen } = useUIStore();

  return (
    <Dialog open={aboutModalOpen} onOpenChange={setAboutModalOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">Naval Correspondence Generator</span>
            <Badge variant="secondary">v{VERSION}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <p className="text-muted-foreground italic border-l-2 border-primary pl-3">
            Professional document generation for Marines, by Marines.
          </p>

          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Author</h4>
            <p className="font-medium">Roberto Chiofalo</p>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Why It's Better</h4>
            <ul className="space-y-2.5">
              <li className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>LaTeX-quality typesetting</strong> — Publication-grade documents that look professionally printed
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>Full classification support</strong> — CUI through TOP SECRET//SCI with proper markings
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>18 document types</strong> — Letters, memoranda, endorsements, MOA/MOU, and more
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>NIST 800-171 compliant</strong> — No data ever leaves your browser
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Plane className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>Air-gap capable</strong> — Works completely offline on SIPR/classified networks
                </span>
              </li>
            </ul>
          </div>

          <div className="pt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('https://github.com/rchiofalo/libo-secured', '_blank')}
            >
              <Github className="h-4 w-4 mr-2" />
              View on GitHub
              <ExternalLink className="h-3 w-3 ml-1.5 opacity-50" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
