import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentStore } from '@/stores/documentStore';
import type { DocTypeConfig } from '@/types/document';
import { ALL_SERVICE_RANKS, formatRank } from '@/data/ranks';

// Check if a rank value is a standard military rank
function isStandardMilitaryRank(rank: string): boolean {
  if (!rank) return true; // Empty is considered standard (will show dropdown)
  for (const service of ALL_SERVICE_RANKS) {
    for (const category of service.categories) {
      for (const r of category.ranks) {
        if (formatRank(r.abbrev, service.suffix) === rank) {
          return true;
        }
      }
    }
  }
  return false;
}

interface SignatureSectionProps {
  config: DocTypeConfig;
}

export function SignatureSection({ config: _config }: SignatureSectionProps) {
  // config will be used for signature type variations (abbrev, full, dual)
  void _config;
  const { formData, setField } = useDocumentStore();
  const [useCustomRank, setUseCustomRank] = useState(false);

  // Initialize useCustomRank based on current sigRank value
  useEffect(() => {
    setUseCustomRank(!isStandardMilitaryRank(formData.sigRank || ''));
  }, [formData.sigRank]);

  return (
    <Accordion type="single" collapsible defaultValue="signature">
      <AccordionItem value="signature">
        <AccordionTrigger>Signature Block</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Name fields */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sigFirst">First Name</Label>
                <Input
                  id="sigFirst"
                  value={formData.sigFirst || ''}
                  onChange={(e) => setField('sigFirst', e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sigMiddle">M.I.</Label>
                <Input
                  id="sigMiddle"
                  value={formData.sigMiddle || ''}
                  onChange={(e) => setField('sigMiddle', e.target.value)}
                  placeholder="A."
                  maxLength={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sigLast">Last Name</Label>
                <Input
                  id="sigLast"
                  value={formData.sigLast || ''}
                  onChange={(e) => setField('sigLast', e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>

            {/* Rank and Title */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={!useCustomRank ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    if (useCustomRank) {
                      setUseCustomRank(false);
                      setField('sigRank', '');
                    }
                  }}
                >
                  Military
                </Button>
                <Button
                  type="button"
                  variant={useCustomRank ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    if (!useCustomRank) {
                      setUseCustomRank(true);
                      setField('sigRank', '');
                    }
                  }}
                >
                  Civilian / Other
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sigRank">Rank / Title</Label>
                  {useCustomRank ? (
                    <Input
                      id="sigRank"
                      value={formData.sigRank || ''}
                      onChange={(e) => setField('sigRank', e.target.value)}
                      placeholder="e.g., Mr., Ms., Dr., Contractor"
                    />
                  ) : (
                    <Select
                      value={formData.sigRank || ''}
                      onValueChange={(v) => setField('sigRank', v)}
                    >
                      <SelectTrigger id="sigRank">
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
                                    key={`${service.suffix}-${rank.abbrev}`}
                                    value={formatRank(rank.abbrev, service.suffix)}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground w-10">
                                        {rank.grade}
                                      </span>
                                      <span>{rank.abbrev}</span>
                                      <span className="text-muted-foreground">- {rank.title}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sigTitle">Position</Label>
                  <Input
                    id="sigTitle"
                    value={formData.sigTitle || ''}
                    onChange={(e) => setField('sigTitle', e.target.value)}
                    placeholder="e.g., Operations NCO"
                  />
                </div>
              </div>
            </div>

            {/* By Direction */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="byDirection"
                  checked={formData.byDirection || false}
                  onCheckedChange={(checked) => setField('byDirection', !!checked)}
                />
                <Label htmlFor="byDirection" className="font-normal">
                  By direction of...
                </Label>
              </div>

              {formData.byDirection && (
                <div className="space-y-2 ml-6">
                  <Label htmlFor="byDirectionAuthority">Authority</Label>
                  <Input
                    id="byDirectionAuthority"
                    value={formData.byDirectionAuthority || ''}
                    onChange={(e) => setField('byDirectionAuthority', e.target.value)}
                    placeholder="the Commanding Officer"
                  />
                </div>
              )}
            </div>

            {/* POC Email */}
            <div className="space-y-2">
              <Label htmlFor="pocEmail">POC Email</Label>
              <Input
                id="pocEmail"
                type="email"
                value={formData.pocEmail || ''}
                onChange={(e) => setField('pocEmail', e.target.value)}
                placeholder="john.doe@usmc.mil"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
