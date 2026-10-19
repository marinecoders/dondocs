import { ListTree, X, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import type { ParagraphStructureFinding } from '@/lib/paragraphStructureValidation';

interface ParagraphStructureModalProps {
  findings: ParagraphStructureFinding[] | null;
  onCancel: () => void;
  onProceed: () => void;
}

/**
 * Last look at the SECNAV M-5216.5 Ch 7 ¶13/¶13d paragraph-structure findings
 * before the document leaves the app.
 *
 * The same findings already sit under the paragraph editor; this repeats them
 * at the moment of the decision, which is the only moment that reliably has the
 * drafter's attention. It does NOT block: "Download anyway" is a real option,
 * because a lone subparagraph is exactly what a work-in-progress looks like and
 * people export drafts to circulate for comment all the time.
 *
 * Deliberately quieter than the PII modal — warning tone, not destructive. A
 * formatting inconsistency is not a privacy spill, and giving them the same
 * visual weight would teach drafters to dismiss both.
 */
export function ParagraphStructureModal({
  findings,
  onCancel,
  onProceed,
}: ParagraphStructureModalProps) {
  const open = useUIStore((s) => s.structureWarningOpen);
  const setOpen = useUIStore((s) => s.setStructureWarningOpen);

  if (!findings || findings.length === 0) return null;

  const close = () => {
    setOpen(false);
    onCancel();
  };

  const proceed = () => {
    setOpen(false);
    onProceed();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-xl max-h-[85dvh] flex flex-col gap-0 p-0 overflow-hidden" showCloseButton={false}>
        <div className="bg-warning shrink-0 px-6 py-4 text-warning-foreground">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-white/20 p-2">
              <ListTree className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Check paragraph structure</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-inherit">
                {findings.length} thing{findings.length === 1 ? '' : 's'} to look at before you send this
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto">
            <div className="space-y-2 p-6">
              {findings.map((f, i) => (
                <div key={i} className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                  {f.message}
                </div>
              ))}
            </div>


          <div className="border-t bg-muted/50 px-6 py-3 text-sm text-muted-foreground">
            These are formatting rules from the correspondence manual, not blockers. Download
            anyway if you are circulating a draft.
          </div>

        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:gap-2">
          <Button variant="outline" onClick={close} className="gap-2">
            <X className="h-4 w-4" />
            Go back and fix
          </Button>
          <Button onClick={proceed} className="gap-2">
            <Download className="h-4 w-4" />
            Download anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
