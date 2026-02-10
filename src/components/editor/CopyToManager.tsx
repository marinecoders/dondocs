import { Plus, Trash2, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';

export function CopyToManager() {
  const { copyTos, addCopyTo, updateCopyTo, removeCopyTo } = useDocumentStore();

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="copyto">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Copy To (Distribution)
            <Badge variant="secondary" className="min-w-[28px] justify-center">
              {copyTos.length}
            </Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium mb-1">Copy To (Distribution)</p>
                  <p className="text-xs">
                    List additional recipients who should receive a copy of this correspondence. Appears at the bottom of the document after the signature block.
                  </p>
                  <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                    <li><strong>Format:</strong> Use full command name or abbreviation</li>
                    <li><strong>Order:</strong> List recipients by seniority or as directed</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pt-2 space-y-2">
            {copyTos.map((ct, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={ct.text}
                  onChange={(e) => updateCopyTo(index, e.target.value)}
                  placeholder="Recipient..."
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCopyTo(index)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={() => addCopyTo('')}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Recipient
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
