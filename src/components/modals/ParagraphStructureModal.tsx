import { ListTree, X, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden" showCloseButton={false}>
        <div className="bg-warning px-6 py-5 text-warning-foreground">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-white/20 p-3">
              <ListTree className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Check paragraph structure</h2>
              <p className="mt-1 text-sm opacity-80">
                {findings.length} thing{findings.length === 1 ? '' : 's'} to look at before you send this
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="max-h-[280px]">
          <div className="space-y-2 p-6">
            {findings.map((f, i) => (
              <div key={i} className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                {f.message}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t bg-muted/50 px-6 py-3 text-sm text-muted-foreground">
          These are formatting rules from the correspondence manual, not blockers. Download
          anyway if you are circulating a draft.
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-2">
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
