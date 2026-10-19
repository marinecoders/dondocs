import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { HelpTip } from '@/components/ui/help-tip';
import { useDocumentStore } from '@/stores/documentStore';

export function CopyToManager() {
  const { copyTos, addCopyTo, updateCopyTo, removeCopyTo } = useDocumentStore();

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="copyto">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Copy To
            <span className="text-xs font-normal text-muted-foreground tnum">
              {copyTos.length}
            </span>
            <HelpTip>
              <p className="font-medium mb-1">Copy To</p>
              <p className="text-xs">
                List information addressees who receive a copy of this correspondence for awareness only. Appears at the bottom of the document after the signature block.
              </p>
              <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                <li><strong>Format:</strong> Use full command name or abbreviation</li>
                <li><strong>Order:</strong> List recipients by seniority or as directed</li>
              </ul>
            </HelpTip>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pt-2 editor-recipient-list">
            {copyTos.length === 0 && (
              <p className="text-xs text-muted-foreground">None added.</p>
            )}
            {copyTos.map((ct, index) => (
              <div key={index} className="editor-recipient-row flex items-center gap-2 border-b border-border py-1">
                <Input
                  value={ct.text}
                  onChange={(e) => updateCopyTo(index, e.target.value)}
                  placeholder="Recipient…"
                  aria-label={`Copy-to recipient ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCopyTo(index)}
                  aria-label={`Remove copy-to recipient ${index + 1}`}
                  className="h-11 w-11 sm:h-9 sm:w-9 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs font-normal"
              onClick={() => addCopyTo('')}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add recipient
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
