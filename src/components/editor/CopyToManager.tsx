import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
            <Badge variant="secondary" className="min-w-[28px] justify-center tnum">
              {copyTos.length}
            </Badge>
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
          <div className="pt-2 space-y-2">
            {copyTos.length === 0 && (
              <p className="text-xs text-muted-foreground">None added.</p>
            )}
            {copyTos.map((ct, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={ct.text}
                  onChange={(e) => updateCopyTo(index, e.target.value)}
                  placeholder="Recipient…"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCopyTo(index)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
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
