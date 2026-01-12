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
import { useDocumentStore } from '@/stores/documentStore';

export function CopyToManager() {
  const { copyTos, addCopyTo, updateCopyTo, removeCopyTo } = useDocumentStore();

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="copyto">
        <AccordionTrigger>
          Copy To (Distribution)
          {copyTos.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {copyTos.length}
            </Badge>
          )}
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
