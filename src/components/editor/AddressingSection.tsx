import { useState, useMemo, useCallback } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { InputWithVariables } from '@/components/ui/variable-autocomplete';
import { useDocumentStore } from '@/stores/documentStore';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import type { DocTypeConfig } from '@/types/document';

interface AddressingSectionProps {
  config: DocTypeConfig;
}

export function AddressingSection({ config }: AddressingSectionProps) {
  const { formData, setField } = useDocumentStore();
  const [ssicModalOpen, setSSICModalOpen] = useState(false);

  const handleSSICSelect = (code: string) => {
    setField('ssic', code);
  };

  // Parse via string into array (split by newlines, keep empty for editing)
  const viaLines = useMemo(() => {
    if (!formData.via) return [''];
    const lines = formData.via.split('\n');
    return lines.length > 0 ? lines : [''];
  }, [formData.via]);

  // Update via field from array
  const updateViaLines = useCallback((lines: string[]) => {
    setField('via', lines.join('\n'));
  }, [setField]);

  const addViaLine = useCallback(() => {
    updateViaLines([...viaLines, '']);
  }, [viaLines, updateViaLines]);

  const removeViaLine = useCallback((index: number) => {
    const newLines = viaLines.filter((_, i) => i !== index);
    updateViaLines(newLines.length > 0 ? newLines : ['']);
  }, [viaLines, updateViaLines]);

  const updateViaLine = useCallback((index: number, value: string) => {
    const newLines = [...viaLines];
    newLines[index] = value;
    updateViaLines(newLines);
  }, [viaLines, updateViaLines]);

  return (
    <>
      <SSICLookupModal
        open={ssicModalOpen}
        onOpenChange={setSSICModalOpen}
        onSelect={handleSSICSelect}
      />

      <Accordion type="single" collapsible defaultValue="addressing">
        <AccordionItem value="addressing">
          <AccordionTrigger>Document Information</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* SSIC / Serial / Date */}
              {config.ssic && (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ssic">SSIC</Label>
                    <div className="flex gap-1">
                      <Input
                        id="ssic"
                        value={formData.ssic || ''}
                        onChange={(e) => setField('ssic', e.target.value)}
                        placeholder="5216"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setSSICModalOpen(true)}
                        title="Browse SSIC Codes"
                      >
                        <BookOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                <div className="space-y-2">
                  <Label htmlFor="serial">Serial</Label>
                  <Input
                    id="serial"
                    value={formData.serial || ''}
                    onChange={(e) => setField('serial', e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <DatePicker
                    id="date"
                    value={formData.date || ''}
                    onChange={(value) => setField('date', value)}
                    placeholder="15 Dec 24"
                  />
                </div>
              </div>

              {/* In Reply Refer To */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="inReplyTo"
                    checked={formData.inReplyTo || false}
                    onCheckedChange={(checked) => setField('inReplyTo', checked === true)}
                  />
                  <Label htmlFor="inReplyTo" className="cursor-pointer">
                    In Reply Refer To
                  </Label>
                </div>
                {formData.inReplyTo && (
                  <Input
                    value={formData.inReplyToText || ''}
                    onChange={(e) => setField('inReplyToText', e.target.value)}
                    placeholder="Reference letter/document (e.g., CO ltr 5216 Ser 001 of 1 Jan 25)"
                  />
                )}
              </div>
              </>
            )}

            {/* From / To */}
            {config.fromTo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from">From</Label>
                  <InputWithVariables
                    id="from"
                    value={formData.from || ''}
                    onValueChange={(v) => setField('from', v)}
                    placeholder="Commanding Officer... (type {{ for variables)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to">To</Label>
                  <InputWithVariables
                    id="to"
                    value={formData.to || ''}
                    onValueChange={(v) => setField('to', v)}
                    placeholder="Commanding General... (type {{ for variables)"
                  />
                </div>
              </div>
            )}

            {/* Via */}
            {config.via && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Via</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addViaLine}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Via
                  </Button>
                </div>
                <div className="space-y-2">
                  {viaLines.map((line, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Badge variant="secondary" className="shrink-0 min-w-[36px] justify-center">
                        ({index + 1})
                      </Badge>
                      <Input
                        value={line}
                        onChange={(e) => updateViaLine(index, e.target.value)}
                        placeholder="Commanding Officer, 6th Marine Regiment"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeViaLine(index)}
                        disabled={viaLines.length === 1 && !line}
                        className="shrink-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <InputWithVariables
                id="subject"
                value={formData.subject || ''}
                onValueChange={(v) => setField('subject', v)}
                placeholder="SUBJECT LINE... (type {{ for variables)"
                className="uppercase"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  );
}
