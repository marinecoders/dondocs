import { useState } from 'react';
import { Building2, BookOpen, Shield } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useDocumentStore } from '@/stores/documentStore';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { type UnitInfo } from '@/data/unitDirectory';
import { ALL_SERVICE_RANKS, formatRank } from '@/data/ranks';
import type { SignatureType } from '@/types/document';

export function MOASection() {
  const { formData, setField, docType } = useDocumentStore();
  const [seniorUnitModalOpen, setSeniorUnitModalOpen] = useState(false);
  const [juniorUnitModalOpen, setJuniorUnitModalOpen] = useState(false);
  const [seniorSSICModalOpen, setSeniorSSICModalOpen] = useState(false);
  const [juniorSSICModalOpen, setJuniorSSICModalOpen] = useState(false);

  const documentLabel = docType === 'moa' ? 'Memorandum of Agreement' : 'Memorandum of Understanding';

  const handleSeniorUnitSelect = (unit: UnitInfo) => {
    setField('seniorCommandName', unit.name);
  };

  const handleJuniorUnitSelect = (unit: UnitInfo) => {
    setField('juniorCommandName', unit.name);
  };

  return (
    <>
      <UnitLookupModal
        open={seniorUnitModalOpen}
        onOpenChange={setSeniorUnitModalOpen}
        onSelect={handleSeniorUnitSelect}
      />
      <UnitLookupModal
        open={juniorUnitModalOpen}
        onOpenChange={setJuniorUnitModalOpen}
        onSelect={handleJuniorUnitSelect}
      />
      <SSICLookupModal
        open={seniorSSICModalOpen}
        onOpenChange={setSeniorSSICModalOpen}
        onSelect={(code) => setField('seniorSSIC', code)}
      />
      <SSICLookupModal
        open={juniorSSICModalOpen}
        onOpenChange={setJuniorSSICModalOpen}
        onSelect={(code) => setField('juniorSSIC', code)}
      />

      {/* Subject Line */}
      <Accordion type="single" collapsible defaultValue="moa-subject">
        <AccordionItem value="moa-subject">
          <AccordionTrigger>{documentLabel}</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 10:</p>
                <p className="text-xs mt-1">
                  {docType === 'moa'
                    ? 'A Memorandum of Agreement documents a mutual agreement between two or more parties on specific matters.'
                    : 'A Memorandum of Understanding documents a general understanding between two or more parties.'}
                  {' '}The junior command signs first (left), senior command signs last (right).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="moaSubject">Subject</Label>
                <Input
                  id="moaSubject"
                  value={formData.moaSubject || ''}
                  onChange={(e) => setField('moaSubject', e.target.value)}
                  placeholder="SUBJECT LINE IN ALL CAPS"
                  className="uppercase"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Senior Command (Signs Last - Right Side) */}
      <Accordion type="single" collapsible defaultValue="senior-command">
        <AccordionItem value="senior-command">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Senior Command</span>
              <span className="text-xs text-muted-foreground font-normal">(Signs Last - Right)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Command Info */}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeniorUnitModalOpen(true)}
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4" />
                  Browse Units
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="seniorCommandName">Command Name</Label>
                <Input
                  id="seniorCommandName"
                  value={formData.seniorCommandName || ''}
                  onChange={(e) => setField('seniorCommandName', e.target.value)}
                  placeholder="e.g., COMMANDING GENERAL, 2D MARINE DIVISION"
                />
              </div>

              {/* SSIC / Serial / Date */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="seniorSSIC">SSIC</Label>
                  <div className="flex gap-1">
                    <Input
                      id="seniorSSIC"
                      value={formData.seniorSSIC || ''}
                      onChange={(e) => setField('seniorSSIC', e.target.value)}
                      placeholder="5216"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setSeniorSSICModalOpen(true)}
                      title="Browse SSIC Codes"
                    >
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seniorSerial">Serial</Label>
                  <Input
                    id="seniorSerial"
                    value={formData.seniorSerial || ''}
                    onChange={(e) => setField('seniorSerial', e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seniorDate">Date</Label>
                  <DatePicker
                    id="seniorDate"
                    value={formData.seniorDate || ''}
                    onChange={(value) => setField('seniorDate', value)}
                    placeholder="15 Dec 24"
                  />
                </div>
              </div>

              {/* Signatory */}
              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-medium">Signatory</Label>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="space-y-2">
                    <Label htmlFor="seniorSigName">Full Name</Label>
                    <Input
                      id="seniorSigName"
                      value={formData.seniorSigName || ''}
                      onChange={(e) => setField('seniorSigName', e.target.value)}
                      placeholder="JOHN A. SMITH"
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seniorSigRank">Rank</Label>
                    <Select
                      value={formData.seniorSigRank || ''}
                      onValueChange={(v) => setField('seniorSigRank', v)}
                    >
                      <SelectTrigger id="seniorSigRank">
                        <SelectValue placeholder="Select rank..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {ALL_SERVICE_RANKS.map((service) => (
                          <SelectGroup key={service.suffix}>
                            <SelectLabel className="font-bold text-primary">
                              {service.service}
                            </SelectLabel>
                            {service.categories.map((category) => (
                              <SelectGroup key={`${service.suffix}-${category.name}`}>
                                <SelectLabel className="text-muted-foreground pl-2">
                                  {category.name}
                                </SelectLabel>
                                {category.ranks.map((rank) => (
                                  <SelectItem
                                    key={`senior-${service.suffix}-${rank.abbrev}`}
                                    value={formatRank(rank.abbrev, service.suffix)}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground w-10">
                                        {rank.grade}
                                      </span>
                                      <span>{rank.abbrev}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <Label htmlFor="seniorSigTitle">Title/Position</Label>
                  <Input
                    id="seniorSigTitle"
                    value={formData.seniorSigTitle || ''}
                    onChange={(e) => setField('seniorSigTitle', e.target.value)}
                    placeholder="e.g., Commanding General"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Junior Command (Signs First - Left Side) */}
      <Accordion type="single" collapsible defaultValue="junior-command">
        <AccordionItem value="junior-command">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Junior Command</span>
              <span className="text-xs text-muted-foreground font-normal">(Signs First - Left)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Command Info */}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setJuniorUnitModalOpen(true)}
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4" />
                  Browse Units
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="juniorCommandName">Command Name</Label>
                <Input
                  id="juniorCommandName"
                  value={formData.juniorCommandName || ''}
                  onChange={(e) => setField('juniorCommandName', e.target.value)}
                  placeholder="e.g., COMMANDING OFFICER, 1ST BATTALION, 6TH MARINES"
                />
              </div>

              {/* SSIC / Serial / Date */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="juniorSSIC">SSIC</Label>
                  <div className="flex gap-1">
                    <Input
                      id="juniorSSIC"
                      value={formData.juniorSSIC || ''}
                      onChange={(e) => setField('juniorSSIC', e.target.value)}
                      placeholder="5216"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setJuniorSSICModalOpen(true)}
                      title="Browse SSIC Codes"
                    >
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="juniorSerial">Serial</Label>
                  <Input
                    id="juniorSerial"
                    value={formData.juniorSerial || ''}
                    onChange={(e) => setField('juniorSerial', e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="juniorDate">Date</Label>
                  <DatePicker
                    id="juniorDate"
                    value={formData.juniorDate || ''}
                    onChange={(value) => setField('juniorDate', value)}
                    placeholder="15 Dec 24"
                  />
                </div>
              </div>

              {/* Signatory */}
              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-medium">Signatory</Label>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="space-y-2">
                    <Label htmlFor="juniorSigName">Full Name</Label>
                    <Input
                      id="juniorSigName"
                      value={formData.juniorSigName || ''}
                      onChange={(e) => setField('juniorSigName', e.target.value)}
                      placeholder="JANE B. DOE"
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="juniorSigRank">Rank</Label>
                    <Select
                      value={formData.juniorSigRank || ''}
                      onValueChange={(v) => setField('juniorSigRank', v)}
                    >
                      <SelectTrigger id="juniorSigRank">
                        <SelectValue placeholder="Select rank..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {ALL_SERVICE_RANKS.map((service) => (
                          <SelectGroup key={service.suffix}>
                            <SelectLabel className="font-bold text-primary">
                              {service.service}
                            </SelectLabel>
                            {service.categories.map((category) => (
                              <SelectGroup key={`${service.suffix}-${category.name}`}>
                                <SelectLabel className="text-muted-foreground pl-2">
                                  {category.name}
                                </SelectLabel>
                                {category.ranks.map((rank) => (
                                  <SelectItem
                                    key={`junior-${service.suffix}-${rank.abbrev}`}
                                    value={formatRank(rank.abbrev, service.suffix)}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground w-10">
                                        {rank.grade}
                                      </span>
                                      <span>{rank.abbrev}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <Label htmlFor="juniorSigTitle">Title/Position</Label>
                  <Input
                    id="juniorSigTitle"
                    value={formData.juniorSigTitle || ''}
                    onChange={(e) => setField('juniorSigTitle', e.target.value)}
                    placeholder="e.g., Commanding Officer"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Signature Style */}
      <Accordion type="single" collapsible defaultValue="moa-signature">
        <AccordionItem value="moa-signature">
          <AccordionTrigger>Signature Style</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-secondary/50 rounded-lg text-sm">
                <p className="text-muted-foreground">
                  Per SECNAV M-5216.5, MOA/MOU signatures use overscored (line above) full names.
                  Both signatories will use the same signature style.
                </p>
              </div>

              <div className="space-y-3">
                <Label>Signature Style</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={(formData.signatureType || 'none') === 'none' ? 'default' : 'outline'}
                    size="sm"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => setField('signatureType', 'none' as SignatureType)}
                  >
                    <span className="text-xs">Typed Only</span>
                    <span className="text-[10px] text-muted-foreground">Overscored names</span>
                  </Button>
                  <Button
                    type="button"
                    variant={formData.signatureType === 'digital' ? 'default' : 'outline'}
                    size="sm"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => setField('signatureType', 'digital' as SignatureType)}
                  >
                    <Shield className="h-4 w-4" />
                    <span className="text-xs">Digital Fields</span>
                  </Button>
                </div>

                {formData.signatureType === 'digital' && (
                  <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                          Dual Digital Signature Fields
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          Empty signature fields will be placed above BOTH signatory blocks.
                          After downloading, both parties can digitally sign using CAC/PIV.
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                          <strong>Signing Order:</strong> Junior signs first (left), Senior signs last (right).
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
