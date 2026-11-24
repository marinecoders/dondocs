import { additionalJointCommands, emptyJointCommand, type JointLetterCommand } from '@/lib/jointLetterCommands';
import { WordSignatureImage } from './WordSignatureImage';
import { ActingCheckbox } from './SigningCapacityField';
import { EditorGuidance } from './EditorGuidance';
import { useState } from 'react';
import { Building2, BookOpen, Type, Shield } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { IconTip } from '@/components/ui/icon-tip';
import { DatePicker } from '@/components/ui/date-picker';
import { Textarea } from '@/components/ui/textarea';
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
import type { SignatureType } from '@/types/document';

export function JointLetterSection() {
  const { formData, setField, setFormData } = useDocumentStore();
  const additional = additionalJointCommands(formData)[0];
  const updateAdditional = (patch: Partial<JointLetterCommand>) => {
    if (additional) setField('jointAdditionalCommands', [{ ...additional, ...patch }]);
  };
  const swapJuniorAndAdditional = () => {
    if (!additional) return;
    setFormData({
      jointJuniorName: additional.name, jointJuniorZip: additional.location, jointJuniorCode: additional.code,
      jointJuniorSSIC: additional.ssic, jointJuniorSerial: additional.serial, jointJuniorDate: additional.date,
      jointJuniorFrom: additional.from, jointJuniorSigName: additional.signatureName,
      jointJuniorSigTitle: additional.signatureTitle, juniorActing: additional.acting,
      jointAdditionalCommands: [{ ...additional, name: formData.jointJuniorName || '', location: formData.jointJuniorZip || '',
        code: formData.jointJuniorCode || '', ssic: formData.jointJuniorSSIC || '', serial: formData.jointJuniorSerial || '',
        date: formData.jointJuniorDate || '', from: formData.jointJuniorFrom || '',
        signatureName: formData.jointJuniorSigName || '', signatureTitle: formData.jointJuniorSigTitle || '', acting: !!formData.juniorActing }],
    });
  };
  const [seniorUnitModalOpen, setSeniorUnitModalOpen] = useState(false);
  const [juniorUnitModalOpen, setJuniorUnitModalOpen] = useState(false);
  const [juniorSSICModalOpen, setJuniorSSICModalOpen] = useState(false);

  const handleSeniorUnitSelect = (unit: UnitInfo) => {
    setField('jointSeniorName', unit.name);
    if (unit.city && unit.state) {
      setField('jointSeniorZip', `${unit.city}, ${unit.state}`);
    }
  };

  const handleJuniorUnitSelect = (unit: UnitInfo) => {
    setField('jointJuniorName', unit.name);
    if (unit.city && unit.state) {
      setField('jointJuniorZip', `${unit.city}, ${unit.state}`);
    }
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
        open={juniorSSICModalOpen}
        onOpenChange={setJuniorSSICModalOpen}
        onSelect={(code) => setField('jointJuniorSSIC', code)}
      />

      {/* Joint Letter Info */}
      <Accordion type="single" collapsible defaultValue="joint-info">
        <AccordionItem value="joint-info">
          <AccordionTrigger>Addressing</AccordionTrigger>
          <AccordionContent>
            <div className="editor-field-groups pt-2">
              <EditorGuidance title="Joint letter guidance">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 2:</p>
                <p className="text-xs mt-1">
                  Joint letters coordinate two or three commands. Command titles are stacked, senior first. Each command has its own identification block; the senior command signs last on the right.
                </p>
              </EditorGuidance>

              {/* Common Location */}
              <div className="space-y-2">
                <Label htmlFor="jointCommonLocation">Common Location</Label>
                <Input
                  id="jointCommonLocation"
                  value={formData.jointCommonLocation || ''}
                  onChange={(e) => setField('jointCommonLocation', e.target.value)}
                  placeholder="e.g., CAMP PENDLETON, CA"
                />
              </div>

              {/* To */}
              <div className="space-y-2">
                <Label htmlFor="jointTo">To</Label>
                <Input
                  id="jointTo"
                  value={formData.jointTo || ''}
                  onChange={(e) => setField('jointTo', e.target.value)}
                />
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="jointSubject">Subject</Label>
                <Input
                  id="jointSubject"
                  value={formData.jointSubject || ''}
                  onChange={(e) => setField('jointSubject', e.target.value)}
                  className="uppercase"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Senior command stays at the top and signs last. */}
      <Accordion type="single" collapsible defaultValue="senior-letterhead">
        <AccordionItem value="senior-letterhead">
          <AccordionTrigger data-field-group>
            <div className="flex items-center gap-2">
              <span>Senior command letterhead</span>
              <span className="text-xs text-muted-foreground font-normal">(Top · signs last)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="editor-field-groups pt-2">
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
                <Label htmlFor="jointSeniorName">Command Name</Label>
                <Input
                  id="jointSeniorName"
                  value={formData.jointSeniorName || ''}
                  onChange={(e) => setField('jointSeniorName', e.target.value)}
                  placeholder="e.g., MARINE CORPS BASE CAMP PENDLETON"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jointSeniorZip">Location/City</Label>
                  <Input
                    id="jointSeniorZip"
                    value={formData.jointSeniorZip || ''}
                    onChange={(e) => setField('jointSeniorZip', e.target.value)}
                    placeholder="e.g., CAMP PENDLETON, CA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jointSeniorCode">Command code</Label>
                  <Input
                    id="jointSeniorCode"
                    value={formData.jointSeniorCode || ''}
                    onChange={(e) => setField('jointSeniorCode', e.target.value)}
                    placeholder="e.g., 92055-5000"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointSeniorFrom">From Line</Label>
                <Input
                  id="jointSeniorFrom"
                  value={formData.jointSeniorFrom || ''}
                  onChange={(e) => setField('jointSeniorFrom', e.target.value)}
                  placeholder="e.g., Commanding General, Marine Corps Base Camp Pendleton"
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-medium">Signatory</Label>
                <div className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label htmlFor="jointSeniorSigName">Full Name</Label>
                    <Input
                      id="jointSeniorSigName"
                      value={formData.jointSeniorSigName || ''}
                      onChange={(e) => setField('jointSeniorSigName', e.target.value)}
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jointSeniorSigTitle">Title</Label>
                    <Textarea
                      id="jointSeniorSigTitle"
                      value={formData.jointSeniorSigTitle || ''}
                      onChange={(e) => setField('jointSeniorSigTitle', e.target.value)}
                      placeholder="Major General, U.S. Marine Corps&#10;Commanding General"
                      rows={2}
                    />
                  </div>
                </div>
                <ActingCheckbox id="seniorActing" checked={formData.seniorActing}
                  onCheckedChange={(checked) => setField('seniorActing', checked)} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Junior command signs first, at the left. */}
      <Accordion type="single" collapsible defaultValue="junior-letterhead">
        <AccordionItem value="junior-letterhead">
          <AccordionTrigger data-field-group>
            <div className="flex items-center gap-2">
              <span>Junior command letterhead</span>
              <span className="text-xs text-muted-foreground font-normal">(Signs first · left)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="editor-field-groups pt-2">
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
                <Label htmlFor="jointJuniorName">Command Name</Label>
                <Input
                  id="jointJuniorName"
                  value={formData.jointJuniorName || ''}
                  onChange={(e) => setField('jointJuniorName', e.target.value)}
                  placeholder="e.g., 1ST MARINE DIVISION"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jointJuniorZip">Location/City</Label>
                  <Input
                    id="jointJuniorZip"
                    value={formData.jointJuniorZip || ''}
                    onChange={(e) => setField('jointJuniorZip', e.target.value)}
                    placeholder="e.g., CAMP PENDLETON, CA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jointJuniorCode">Command code</Label>
                  <Input
                    id="jointJuniorCode"
                    value={formData.jointJuniorCode || ''}
                    onChange={(e) => setField('jointJuniorCode', e.target.value)}
                    placeholder="e.g., 92055-5380"
                  />
                </div>
              </div>

              {/* SSIC / Serial / Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jointJuniorSSIC">SSIC</Label>
                  <div className="flex gap-1">
                    <Input
                      id="jointJuniorSSIC"
                      value={formData.jointJuniorSSIC || ''}
                      onChange={(e) => setField('jointJuniorSSIC', e.target.value)}
                      placeholder="5216"
                      className="flex-1"
                    />
                    <IconTip label="Browse SSIC codes">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setJuniorSSICModalOpen(true)}
                      >
                        <BookOpen className="h-4 w-4" />
                      </Button>
                    </IconTip>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jointJuniorSerial">Serial</Label>
                  <Input
                    id="jointJuniorSerial"
                    value={formData.jointJuniorSerial || ''}
                    onChange={(e) => setField('jointJuniorSerial', e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jointJuniorDate">Date</Label>
                  <DatePicker
                    id="jointJuniorDate"
                    value={formData.jointJuniorDate || ''}
                    onChange={(value) => setField('jointJuniorDate', value)}
                    placeholder="15 Jan 26"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointJuniorFrom">From Line</Label>
                <Input
                  id="jointJuniorFrom"
                  value={formData.jointJuniorFrom || ''}
                  onChange={(e) => setField('jointJuniorFrom', e.target.value)}
                  placeholder="e.g., Commanding General, 1st Marine Division"
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-medium">Signatory</Label>
                <div className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label htmlFor="jointJuniorSigName">Full Name</Label>
                    <Input
                      id="jointJuniorSigName"
                      value={formData.jointJuniorSigName || ''}
                      onChange={(e) => setField('jointJuniorSigName', e.target.value)}
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jointJuniorSigTitle">Title</Label>
                    <Textarea
                      id="jointJuniorSigTitle"
                      value={formData.jointJuniorSigTitle || ''}
                      onChange={(e) => setField('jointJuniorSigTitle', e.target.value)}
                      placeholder="Major General, U.S. Marine Corps&#10;Commanding General"
                      rows={2}
                    />
                  </div>
                </div>
                <ActingCheckbox id="juniorActing" checked={formData.juniorActing}
                  onCheckedChange={(checked) => setField('juniorActing', checked)} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="space-y-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">Two or three commands are supported. The senior command stays first in the letterhead and last in signing order.</p>
        {!additional ? (
          <Button type="button" variant="outline" onClick={() => setField('jointAdditionalCommands', [emptyJointCommand()])}>Add third command</Button>
        ) : (
          <Accordion type="single" collapsible defaultValue="additional-command">
            <AccordionItem value="additional-command">
              <AccordionTrigger>Third command · middle signature</AccordionTrigger>
              <AccordionContent>
                <div className="editor-field-groups pt-2">
                  <p className="text-xs text-muted-foreground">The third command appears between the junior and senior signatures. Three commands is the current limit.</p>
                  {([
                    ['name', 'Command name'], ['location', 'City, state and ZIP'], ['code', 'Command code'],
                    ['ssic', 'SSIC'], ['serial', 'Serial'], ['from', 'From line'],
                    ['signatureName', 'Signatory name'], ['signatureTitle', 'Signatory title'],
                  ] as const).map(([field, label]) => (
                    <div className="space-y-2" key={field}>
                      <Label htmlFor={`joint-additional-${field}`}>{label}</Label>
                      {field === 'signatureTitle' ? <Textarea id={`joint-additional-${field}`} value={additional[field]} rows={2} onChange={event => updateAdditional({ [field]: event.target.value })} /> :
                        <Input id={`joint-additional-${field}`} value={additional[field]} onChange={event => updateAdditional({ [field]: event.target.value })} />}
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Label htmlFor="joint-additional-date">Date</Label>
                    <DatePicker id="joint-additional-date" value={additional.date} onChange={date => updateAdditional({ date })} />
                  </div>
                  <ActingCheckbox id="joint-additional-acting" checked={additional.acting} onCheckedChange={acting => updateAdditional({ acting })} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={swapJuniorAndAdditional}>Swap with junior command</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setField('jointAdditionalCommands', [])}>Remove third command</Button>
                  </div>
                  {formData.signatureType === 'image' && <p role="alert" className="text-sm text-destructive">Choose Typed Only or Digital Fields below before exporting this three-command letter.</p>}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>

      {/* Signature Options */}
      <Accordion type="single" collapsible defaultValue="signature-options">
        <AccordionItem value="signature-options">
          <AccordionTrigger data-field-group>Signature options</AccordionTrigger>
          <AccordionContent>
            <div className="editor-field-groups pt-2">
              <EditorGuidance title="Joint letter guidance">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 7:</p>
                <p className="text-xs mt-1">
                  The junior command signs FIRST (left side), then the senior command signs LAST (right side).
                  The additional command, when present, signs in the middle.
                </p>
              </EditorGuidance>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    aria-pressed={(formData.signatureType || 'none') === 'none'}
                    variant={(formData.signatureType || 'none') === 'none' ? 'default' : 'outline'}
                    size="sm"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => setField('signatureType', 'none' as SignatureType)}
                  >
                    <Type className="h-5 w-5" />
                    <span className="text-xs">Typed Only</span>
                  </Button>
                  <Button
                    type="button"
                    aria-pressed={formData.signatureType === 'digital'}
                    variant={formData.signatureType === 'digital' ? 'default' : 'outline'}
                    size="sm"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => setField('signatureType', 'digital' as SignatureType)}
                  >
                    <Shield className="h-5 w-5" />
                    <span className="text-xs">Digital Fields (PKI)</span>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {(formData.signatureType || 'none') === 'none' && 'Typed names and titles for all signatories.'}
                  {formData.signatureType === 'digital' && 'Adds an empty signature field above each signatory for CAC/PKI signing.'}
                </p>

                {formData.signatureType === 'digital' && (
                  <div className="border rounded-lg p-4 bg-muted/30 border-border">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-primary mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          Digital Signature Fields
                        </p>
                        <p className="text-xs text-muted-foreground">
                          After downloading, sign with your PDF signing application.
                        </p>
                        <ul className="text-xs text-muted-foreground list-disc list-inside mt-2 space-y-1">
                          <li>Adobe Acrobat with CAC/PIV</li>
                          <li>DoD PKI certificate</li>
                          <li>Other digital signature tools</li>
                        </ul>
                        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                          The junior command signs first{additional ? ', then the middle command' : ''}. The senior command signs last.
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
      {!additional && <WordSignatureImage dual />}
    </>
  );
}
