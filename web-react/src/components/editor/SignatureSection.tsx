import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Upload, X, FileImage, PenLine, Shield, Type } from 'lucide-react';
import { useDocumentStore } from '@/stores/documentStore';
import type { DocTypeConfig, SignatureImage, SignatureType } from '@/types/document';
import { ALL_SERVICE_RANKS, formatRank } from '@/data/ranks';
import { OFFICE_CODES, getOfficeCodesByCategory } from '@/data/officeCodes';

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 to data URL for display
function base64ToDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

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

export function SignatureSection({ config }: SignatureSectionProps) {
  const { documentMode, formData, setField } = useDocumentStore();
  const isDualSignature = config.signature === 'dual';
  const isCompliantMode = documentMode === 'compliant';
  const hasDualDigitalSignature = isDualSignature && formData.signatureType === 'digital';
  const [useCustomRank, setUseCustomRank] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Initialize useCustomRank based on current sigRank value
  useEffect(() => {
    setUseCustomRank(!isStandardMilitaryRank(formData.sigRank || ''));
  }, [formData.sigRank]);

  // Generate preview URL from base64 signature
  const signaturePreviewUrl = useMemo(() => {
    if (!formData.signatureImage?.data) return null;
    return base64ToDataUrl(formData.signatureImage.data, 'image/png');
  }, [formData.signatureImage?.data]);

  // Handle signature image upload
  const handleSignatureUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      console.error('Only image files are supported');
      return;
    }

    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    const signatureImage: SignatureImage = {
      name: file.name,
      size: file.size,
      data: base64,
    };

    setField('signatureImage', signatureImage);
  }, [setField]);

  // Handle file input change
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSignatureUpload(file);
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [handleSignatureUpload]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleSignatureUpload(file);
    }
  }, [handleSignatureUpload]);

  // Remove signature image
  const handleRemoveSignature = useCallback(() => {
    setField('signatureImage', undefined);
  }, [setField]);

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

            {/* Office Code */}
            <div className="space-y-2">
              <Label htmlFor="officeCode">Office Code (Optional)</Label>
              <Select
                value={formData.officeCode || ''}
                onValueChange={(v) => setField('officeCode', v === 'none' ? '' : v)}
              >
                <SelectTrigger id="officeCode">
                  <SelectValue placeholder="Select office code..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="none">None</SelectItem>
                  {getOfficeCodesByCategory().map((category) => (
                    <SelectGroup key={category.name}>
                      <SelectLabel className="font-bold text-primary">
                        {category.name}
                      </SelectLabel>
                      {category.codes.map((code) => (
                        <SelectItem key={code.code} value={code.code}>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs w-16">{code.code}</span>
                            <span className="text-muted-foreground">- {code.title}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {OFFICE_CODES.length} office codes available (e.g., S-1, G-3, CO, XO)
              </p>
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

            {/* Signature Type Selection */}
            <div className="space-y-3">
              <Label>Signature Style</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={(formData.signatureType || 'none') === 'none' ? 'default' : 'outline'}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={() => {
                    setField('signatureType', 'none' as SignatureType);
                    if (formData.signatureImage) {
                      setField('signatureImage', undefined);
                    }
                  }}
                >
                  <Type className="h-5 w-5" />
                  <span className="text-xs">Typed Only</span>
                </Button>
                <Button
                  type="button"
                  variant={formData.signatureType === 'image' ? 'default' : 'outline'}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={() => setField('signatureType', 'image' as SignatureType)}
                >
                  <PenLine className="h-5 w-5" />
                  <span className="text-xs">Upload Image</span>
                </Button>
                <Button
                  type="button"
                  variant={formData.signatureType === 'digital' ? 'default' : 'outline'}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={() => {
                    setField('signatureType', 'digital' as SignatureType);
                    if (formData.signatureImage) {
                      setField('signatureImage', undefined);
                    }
                  }}
                >
                  <Shield className="h-5 w-5" />
                  <span className="text-xs">Digital Field</span>
                </Button>
              </div>

              {/* Description based on selection */}
              <p className="text-xs text-muted-foreground">
                {(formData.signatureType || 'none') === 'none' && 'Just your typed name and rank.'}
                {formData.signatureType === 'image' && 'Upload an image of your handwritten signature.'}
                {formData.signatureType === 'digital' && 'Creates an empty signature field for CAC/PKI digital signing.'}
              </p>

              {/* Image Upload - only show when 'image' is selected */}
              {formData.signatureType === 'image' && (
                <>
                  {formData.signatureImage ? (
                    <div className="space-y-2">
                      <div className="relative border rounded-lg p-4 bg-secondary/30">
                        <img
                          src={signaturePreviewUrl || ''}
                          alt="Signature preview"
                          className="max-h-20 mx-auto"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleRemoveSignature}
                          className="absolute top-2 right-2 h-6 w-6"
                          title="Remove signature"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileImage className="h-3 w-3" />
                        <span>{formData.signatureImage.name}</span>
                        <span>({(formData.signatureImage.size / 1024).toFixed(1)} KB)</span>
                      </div>
                    </div>
                  ) : (
                    <label
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                        isDragging
                          ? 'border-primary bg-primary/10'
                          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-secondary/30'
                      }`}
                    >
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Drag & drop or click to upload
                      </span>
                      <span className="text-xs text-muted-foreground">
                        PNG, JPG, or GIF (max 500KB recommended)
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </>
              )}

              {/* Digital Signature Info - only show when 'digital' is selected */}
              {formData.signatureType === 'digital' && (
                <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                        {hasDualDigitalSignature ? 'Dual Digital Signature Fields' : 'Digital Signature Field'}
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        {hasDualDigitalSignature
                          ? 'Empty signature fields will be placed above BOTH signatory blocks (Junior and Senior). Per SECNAV M-5216.5, the junior signs first (left), then the senior (right).'
                          : 'An empty signature field will be placed above your typed name.'}
                        {' '}After downloading, you can digitally sign using:
                      </p>
                      <ul className="text-xs text-blue-700 dark:text-blue-300 list-disc list-inside mt-2 space-y-1">
                        <li>Adobe Acrobat with CAC/PIV</li>
                        <li>DoD PKI certificate</li>
                        <li>Other digital signature tools</li>
                      </ul>
                      {hasDualDigitalSignature && (
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                          <strong>Signing Order:</strong> Junior signatory signs first, then Senior signatory.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
