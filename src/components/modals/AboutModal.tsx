import { useFormCatalog } from '@/services/formCatalog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DOC_TYPE_LABELS } from '@/types/document';
import { LETTER_TEMPLATES } from '@/data/templates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, Zap, FileText, Lock, Plane, ExternalLink } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { useUIStore } from '@/stores/uiStore';
import { APP_VERSION, GIT_SHA, formatBuildTime } from '@/lib/version';
import { BASE_PATH } from '@/config/paths';

export function AboutModal() {
  const catalog = useFormCatalog();
  // Individual selectors so this modal only re-renders when its own flag
  // changes — not when any other modal toggles or an unrelated UI field
  // updates. Setters are stable from Zustand's `create()` callback.
  const aboutModalOpen = useUIStore((s) => s.aboutModalOpen);
  const setAboutModalOpen = useUIStore((s) => s.setAboutModalOpen);
  const sourceRef = GIT_SHA && GIT_SHA !== 'dev' ? GIT_SHA : `v${APP_VERSION}`;

  return (
    <Dialog open={aboutModalOpen} onOpenChange={setAboutModalOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span>DonDocs</span>
            <Badge variant="secondary" title={`Build ${GIT_SHA} · ${formatBuildTime()}`}>
              v{APP_VERSION}
            </Badge>
          </DialogTitle>
          <DialogDescription>Correspondence and forms from Marine Coders.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-2">
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
            <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Workspace capabilities</h4>
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
                  <strong>Classification markings</strong> — Formatting options for banners and portion marks. Use only in an environment authorized for your information.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>{Object.keys(DOC_TYPE_LABELS).length + catalog.length} document formats and {LETTER_TEMPLATES.length} built-in templates</strong> with distribution lists, classification markings, and batch generation
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>Local document processing</strong> — Drafts and attachments are stored in this browser. You choose when to export, back up, or share them.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Plane className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">
                  <strong>Offline deployment support</strong> — Document generation runs locally when the required application assets are available.
                </span>
              </li>
            </ul>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Copyright © 2026 Roberto Chiofalo.</p>
            <p>
              DonDocs is free software under GNU AGPL version 3 only. You may
              redistribute and modify it under that license. It comes without
              warranty; see the license for details.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://github.com/marinecoders/dondocs/tree/${sourceRef}`, '_blank', 'noopener,noreferrer')}
            >
              <GithubIcon className="h-4 w-4 mr-2" />
              Source code
              <ExternalLink className="h-3 w-3 ml-1.5 opacity-50" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${BASE_PATH}LICENSE.txt`, '_blank', 'noopener,noreferrer')}
            >
              AGPL v3 license
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
              <span className="opacity-70">Last Updated:</span>{' '}
              <span>{formatBuildTime()}</span>
            </div>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
