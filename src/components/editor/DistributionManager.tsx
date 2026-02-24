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

export function DistributionManager() {
  const { distributions, addDistribution, updateDistribution, removeDistribution } = useDocumentStore();

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="distribution">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Distribution
            <Badge variant="secondary" className="min-w-[28px] justify-center">
              {distributions.length}
            </Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium mb-1">Distribution</p>
                  <p className="text-xs">
                    List action addressees who must take action on this correspondence. Per SECNAV Ch 8, distribution lists the commands that receive the original for action.
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
            {distributions.map((d, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={d.text}
                  onChange={(e) => updateDistribution(index, e.target.value)}
                  placeholder="Action addressee..."
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeDistribution(index)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={() => addDistribution('')}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Action Addressee
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
