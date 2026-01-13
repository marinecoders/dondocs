import { useState } from 'react';
import { Building2, BookOpen, Type, Shield } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
  const { formData, setField } = useDocumentStore();
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
          <AccordionTrigger>Joint Letter</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 2:</p>
                <p className="text-xs mt-1">
                  A joint letter is signed by two commanding officers from different organizations.
                  Both letterheads appear side-by-side. The junior command provides the SSIC, serial, and date.
                </p>
              </div>

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
                  placeholder="e.g., See Distribution"
                />
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="jointSubject">Subject</Label>
                <Input
                  id="jointSubject"
                  value={formData.jointSubject || ''}
                  onChange={(e) => setField('jointSubject', e.target.value)}
                  placeholder="SUBJECT LINE IN ALL CAPS"
                  className="uppercase"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Senior Command (Left Side) */}
      <Accordion type="single" collapsible defaultValue="senior-letterhead">
        <AccordionItem value="senior-letterhead">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Senior Command Letterhead</span>
              <span className="text-xs text-muted-foreground font-normal">(Left Side)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
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
                  <Label htmlFor="jointSeniorCode">ZIP/Code</Label>
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
                      placeholder="J. A. SMITH"
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
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Junior Command (Right Side) */}
      <Accordion type="single" collapsible defaultValue="junior-letterhead">
        <AccordionItem value="junior-letterhead">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Junior Command Letterhead</span>
              <span className="text-xs text-muted-foreground font-normal">(Right Side - Provides SSIC)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
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
                  <Label htmlFor="jointJuniorCode">ZIP/Code</Label>
                  <Input
                    id="jointJuniorCode"
                    value={formData.jointJuniorCode || ''}
                    onChange={(e) => setField('jointJuniorCode', e.target.value)}
                    placeholder="e.g., 92055-5380"
                  />
                </div>
              </div>

              {/* SSIC / Serial / Date */}
              <div className="grid grid-cols-3 gap-4">
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
                      placeholder="T. R. JONES"
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
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Signature Options */}
      <Accordion type="single" collapsible defaultValue="signature-options">
        <AccordionItem value="signature-options">
          <AccordionTrigger>Signature Options</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 7:</p>
                <p className="text-xs mt-1">
                  The junior command signs FIRST (left side), then the senior command signs LAST (right side).
                  Both signatures use the same style selected below.
                </p>
              </div>

              <div className="space-y-3">
                <Label>Signature Style (Both Signatories)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
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
                  {(formData.signatureType || 'none') === 'none' && 'Just typed names and titles for both signatories.'}
                  {formData.signatureType === 'digital' && 'Creates empty signature fields above BOTH signatory blocks for CAC/PKI digital signing.'}
                </p>

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
                          After downloading, you can digitally sign using:
                        </p>
                        <ul className="text-xs text-blue-700 dark:text-blue-300 list-disc list-inside mt-2 space-y-1">
                          <li>Adobe Acrobat with CAC/PIV</li>
                          <li>DoD PKI certificate</li>
                          <li>Other digital signature tools</li>
                        </ul>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                          <strong>Signing Order:</strong> Junior signatory signs first (left), then Senior signatory (right).
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
