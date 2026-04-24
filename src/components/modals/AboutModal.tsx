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
import { APP_VERSION, GIT_SHA, formatBuildTime } from '@/lib/version';

export function AboutModal() {
  // Individual selectors so this modal only re-renders when its own flag
  // changes — not when any other modal toggles or an unrelated UI field
  // updates. Setters are stable from Zustand's `create()` callback.
  const aboutModalOpen = useUIStore((s) => s.aboutModalOpen);
  const setAboutModalOpen = useUIStore((s) => s.setAboutModalOpen);

  return (
    <Dialog open={aboutModalOpen} onOpenChange={setAboutModalOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">Naval Correspondence Generator</span>
            <Badge variant="secondary" title={`Build ${GIT_SHA} · ${formatBuildTime()}`}>
              v{APP_VERSION}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <p className="text-muted-foreground italic border-l-2 border-primary pl-3">
            Professional document generation for Marines, by Marines.
          </p>

          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Authors</h4>
            <ul className="space-y-1">
              <li className="font-medium">Roberto Chiofalo</li>
              <li className="font-medium">William Crum</li>
              <li className="font-medium">"jeranaias"</li>
            </ul>
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
                  <strong>20 document types and 11 templates</strong> with distribution lists, classification markings, and batch generation
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
              onClick={() => window.open('https://github.com/marinecoders/dondocs', '_blank')}
            >
              <Github className="h-4 w-4 mr-2" />
              View on GitHub
              <ExternalLink className="h-3 w-3 ml-1.5 opacity-50" />
            </Button>
          </div>

          {/* Build info — lets users verify which version they're running.
              If a user reports a bug, have them read these values from the
              About modal to confirm they're on the latest deployed build. */}
          <div className="pt-3 border-t border-border/50 text-xs text-muted-foreground space-y-0.5 font-mono">
            <div>
              <span className="opacity-70">Version:</span>{' '}
              <span>v{APP_VERSION}</span>
            </div>
            <div>
              <span className="opacity-70">Build:</span>{' '}
              <span>{GIT_SHA}</span>
            </div>
            <div>
              <span className="opacity-70">Deployed:</span>{' '}
              <span>{formatBuildTime()}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
