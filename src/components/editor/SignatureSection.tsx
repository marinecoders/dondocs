import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { IconTip } from '@/components/ui/icon-tip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from '@/components/ui/accordion';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { Upload, X, FileImage, PenLine, Shield, Type, Search, AlertCircle } from 'lucide-react';
import { HelpTip } from '@/components/ui/help-tip';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { unfilled } from '@/lib/requiredField';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { FILE_LIMITS } from '@/lib/constants';
import { showAppAlert } from '@/stores/alertStore';
import { isImageFile, rejectedFilesMessage } from '@/lib/fileFilter';
import { formatFileSize } from '@/lib/utils';
import { RequiredMark } from '@/components/ui/required-mark';
import type { DocTypeConfig, SignatureImage, SignatureType } from '@/types/document';
import { ALL_SERVICE_RANKS, formatRank } from '@/data/ranks';
import { getOfficeCode, OFFICE_CODES } from '@/data/officeCodes';
import { OfficeCodeLookupModal } from '@/components/modals/OfficeCodeLookupModal';

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

// Check if an office code is a standard one from the database
function isStandardOfficeCode(code: string): boolean {
  if (!code) return true; // Empty is considered standard (will show lookup)
  return OFFICE_CODES.some(c => c.code === code);
}

interface SignatureSectionProps {
  config: DocTypeConfig;
}

// The three mutually-exclusive signature styles. Rendered as a real radio
// group (roving focus + arrow keys) rather than independent toggle buttons so
// a screen reader announces "1 of 3" and keyboard users arrow between them.
const SIGNATURE_STYLES = [
  { value: 'none', Icon: Type, label: 'Typed Only' },
  { value: 'image', Icon: PenLine, label: 'Upload Image' },
  { value: 'digital', Icon: Shield, label: 'Digital Field' },
] as const;

export function SignatureSection({ config }: SignatureSectionProps) {
  const { formData, setField, documentMode } = useDocumentStore();
  const validationVisible = useUIStore((s) => s.validationVisible);
  const isDualSignature = config.signature === 'dual';
  const hasDualDigitalSignature = isDualSignature && formData.signatureType === 'digital';

  // Check if complimentary close is required (business letters in compliant mode)
  const isCompliantMode = documentMode === 'compliant';
  const requiresComplimentaryClose = isCompliantMode && config.compliance.requiresComplimentaryClose;
  const [useCustomRank, setUseCustomRank] = useState(false);
  const [useCustomOfficeCode, setUseCustomOfficeCode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [officeCodeModalOpen, setOfficeCodeModalOpen] = useState(false);

  // Re-derive the rank-input mode when sigRank changes externally (e.g. a
  // profile load). It's bidirectional: the user can also toggle it below, so it
  // can't be purely derived.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseCustomRank(!isStandardMilitaryRank(formData.sigRank || ''));
  }, [formData.sigRank]);

  // Same bidirectional reset pattern as useCustomRank above, applied
  // to the office-code field.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseCustomOfficeCode(!isStandardOfficeCode(formData.officeCode || ''));
  }, [formData.officeCode]);

  // Generate preview URL from base64 signature. Reading the field into a local
  // const first lets the React Compiler preserve this memo — an optional-chain
  // in the dep array (`signatureImage?.data`) doesn't match its inferred dep.
  const signatureImageData = formData.signatureImage?.data;
  const signaturePreviewUrl = useMemo(() => {
    if (!signatureImageData) return null;
    return base64ToDataUrl(signatureImageData, 'image/png');
  }, [signatureImageData]);

  // Get office code title for display
  const officeCodeDisplay = useMemo(() => {
    if (!formData.officeCode) return '';
    const code = getOfficeCode(formData.officeCode);
    return code ? `${code.code} - ${code.title}` : formData.officeCode;
  }, [formData.officeCode]);

  // Handle signature image upload
  const handleSignatureUpload = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      showAppAlert({ title: 'Image files only', message: rejectedFilesMessage([file], 'image') });
      return;
    }
    // Signatures are stored base64 in localStorage; cap the size so they can't fill it.
    if (file.size > FILE_LIMITS.MAX_SIGNATURE_SIZE_MB * 1024 * 1024) {
      showAppAlert({
        title: 'Image too large',
        message: `That signature image is too large (max ${FILE_LIMITS.MAX_SIGNATURE_SIZE_MB} MB). Please use a smaller file.`,
      });
      return;
    }

    let base64: string;
    try {
      base64 = await loadSignatureAsPngBase64(file);
    } catch (err) {
      showAppAlert({
        title: "Couldn't read that image",
        message: err instanceof Error ? err.message : 'Please try a different file.',
      });
      return;
    }

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
    // `dragleave` also fires when the cursor crosses the drop zone's own child
    // elements (the icon, label, input). Only clear the active tint when the
    // pointer actually leaves the zone — otherwise the border flickers on/off.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Hand any dropped file to the uploader; it validates the type and surfaces
    // an error for non-images instead of the drop silently doing nothing.
    const file = e.dataTransfer.files[0];
    if (file) {
      handleSignatureUpload(file);
    }
  }, [handleSignatureUpload]);

  // Remove signature image
  const handleRemoveSignature = useCallback(() => {
    setField('signatureImage', undefined);
  }, [setField]);

  // Signature-style radio group: select a style and drop any uploaded image
  // when leaving the "image" option (its bytes are meaningless for typed or
  // digital signatures).
  const currentSignatureStyle = (formData.signatureType || 'none') as SignatureType;
  const styleRadioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectSignatureStyle = useCallback((value: SignatureType) => {
    setField('signatureType', value);
    if (value !== 'image' && formData.signatureImage) {
      setField('signatureImage', undefined);
    }
  }, [setField, formData.signatureImage]);

  // Roving focus: arrow keys move selection and focus between the styles, wrap
  // at the ends — the keyboard model a radio group is expected to have.
  const handleStyleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % SIGNATURE_STYLES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + SIGNATURE_STYLES.length) % SIGNATURE_STYLES.length;
    else return;
    e.preventDefault();
    selectSignatureStyle(SIGNATURE_STYLES[next].value);
    styleRadioRefs.current[next]?.focus();
  }, [selectSignatureStyle]);

  return (
    <>
    <Accordion data-tour="signature" type="single" collapsible>
      <AccordionItem value="signature">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Signature Block
            <HelpTip>
              <p className="font-medium mb-1">Signature Block</p>
              <p className="text-xs">
                Configure who signs the document. The signature block appears 4 lines below the last paragraph per SECNAV M-5216.5.
              </p>
              <ul className="text-xs mt-2 space-y-1 list-disc list-inside">
                <li><strong>Typed Only:</strong> Name, rank, and title printed below signature line</li>
                <li><strong>Upload Image:</strong> Overlay a scanned signature above the typed block</li>
                <li><strong>Digital Field:</strong> Creates an empty field for CAC/PIV signing in Adobe</li>
                <li><strong>By Direction:</strong> Sign on behalf of a senior authority</li>
              </ul>
            </HelpTip>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Complimentary Close - Required for business letters in compliant mode */}
            {requiresComplimentaryClose && (
              <div className="space-y-2">
                <Label htmlFor="complimentaryClose">Complimentary Close<RequiredMark /></Label>
                <Input
                  id="complimentaryClose"
                  value={formData.complimentaryClose || ''}
                  onChange={(e) => setField('complimentaryClose', e.target.value)}
                  placeholder="Sincerely,"
                  className={!formData.complimentaryClose?.trim() ? 'border-destructive' : ''}
                />
                {!formData.complimentaryClose?.trim() && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Per SECNAV M-5216.5 Ch 11: Business letters require a complimentary close
                  </p>
                )}
              </div>
            )}

            {/* Name fields */}
            <div data-tour="signature-name" className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-2 col-span-2 sm:col-span-1">
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
              <div className="space-y-2 col-span-3 sm:col-span-1">
                <Label htmlFor="sigLast">Last Name</Label>
                <Input
                  id="sigLast"
                  value={formData.sigLast || ''}
                  onChange={(e) => setField('sigLast', e.target.value)}
                  aria-invalid={validationVisible && unfilled(formData.sigLast) ? true : undefined}
                  placeholder="Doe"
                />
              </div>
            </div>

            {/* Rank and Title, hidden when the config is name-only (e.g. standard_letter). */}
            {config.showSignatureRankTitle !== false && (
            <div className="space-y-3">
              {/* Neutral segmented toggle (matches the Document Type controls;
                  keeps Download the one scarlet primary). */}
              <Tabs
                value={useCustomRank ? 'civilian' : 'military'}
                onValueChange={(v) => {
                  const custom = v === 'civilian';
                  if (custom !== useCustomRank) {
                    setUseCustomRank(custom);
                    setField('sigRank', '');
                  }
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="military">Military</TabsTrigger>
                  <TabsTrigger value="civilian">Civilian / Other</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                        <SelectValue placeholder="Select rank…" />
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
            )}

            {/* Office Code + POC Email */}
            <div className="space-y-3">
              {/* Neutral segmented toggle (consistent with the rank + Document
                  Type controls). */}
              <Tabs
                value={useCustomOfficeCode ? 'custom' : 'standard'}
                onValueChange={(v) => {
                  const custom = v === 'custom';
                  if (custom !== useCustomOfficeCode) {
                    setUseCustomOfficeCode(custom);
                    setField('officeCode', '');
                  }
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="standard">Standard</TabsTrigger>
                  <TabsTrigger value="custom">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label htmlFor="officeCode">Office Code</Label>
                  {useCustomOfficeCode ? (
                    <Input
                      id="officeCode"
                      value={formData.officeCode || ''}
                      onChange={(e) => setField('officeCode', e.target.value)}
                      placeholder="e.g., G-3, S-1, ADMIN"
                    />
                  ) : (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="officeCode"
                          value={officeCodeDisplay}
                          readOnly
                          placeholder="Optional - click search…"
                          className="pr-8 cursor-pointer"
                          onClick={() => setOfficeCodeModalOpen(true)}
                        />
                        {formData.officeCode && (
                          <IconTip label="Clear office code">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                setField('officeCode', '');
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </IconTip>
                        )}
                      </div>
                      <IconTip label="Search office codes">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setOfficeCodeModalOpen(true)}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </IconTip>
                    </div>
                  )}
                </div>
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
                  By direction
                </Label>
              </div>

              {formData.byDirection && (
                <div className="space-y-2 ml-6">
                  <Label htmlFor="byDirectionAuthority">Authority (optional)</Label>
                  <Input
                    id="byDirectionAuthority"
                    value={formData.byDirectionAuthority || ''}
                    onChange={(e) => setField('byDirectionAuthority', e.target.value)}
                    placeholder="Leave blank for a plain “By direction”"
                  />
                  <p className="text-xs text-muted-foreground">
                    Per SECNAV M-5216.5 Ch 7, the signature block reads “By direction.”
                    Name an authority only when the correspondence affects pay and
                    allowances — it then prints “By direction of the Commanding Officer.”
                  </p>
                </div>
              )}
            </div>

            {/* Signature Type Selection */}
            <div data-tour="signature-style" className="space-y-3">
              <Label>Signature Style</Label>
              {/* All signature options available. Selected style reads as a
                  tinted ring (border + 10% tint + primary text), not a solid
                  scarlet fill — a quieter selection state that keeps Download
                  the one scarlet primary. */}
                <div
                  role="radiogroup"
                  aria-label="Signature style"
                  className="grid grid-cols-3 gap-2"
                >
                    {SIGNATURE_STYLES.map((style, index) => {
                      const selected = currentSignatureStyle === style.value;
                      return (
                        <button
                          key={style.value}
                          ref={(el) => { styleRadioRefs.current[index] = el; }}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          className={`flex flex-col items-center gap-1.5 rounded-md border py-3 px-1.5 text-xs font-medium cursor-pointer transition-[color,background-color,border-color,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] ${
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-foreground hover:bg-muted/40'
                          }`}
                          onClick={() => selectSignatureStyle(style.value)}
                          onKeyDown={(e) => handleStyleKeyDown(e, index)}
                        >
                          <style.Icon className="h-5 w-5" />
                          <span>{style.label}</span>
                        </button>
                      );
                    })}
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
                        <span>({formatFileSize(formData.signatureImage.size)})</span>
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
                        PNG, JPG, or GIF — up to {FILE_LIMITS.MAX_SIGNATURE_SIZE_MB} MB (under 500 KB keeps drafts small)
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
                <div className="border-l-2 border-primary/50 pl-3">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {hasDualDigitalSignature ? 'Dual Digital Signature Fields' : 'Digital Signature Field'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {hasDualDigitalSignature
                          ? 'Empty signature fields will be placed above BOTH signatory blocks (Junior and Senior). Per SECNAV M-5216.5, the junior signs first (left), then the senior (right).'
                          : 'An empty signature field will be placed above your typed name.'}
                        {' '}After downloading, you can digitally sign using:
                      </p>
                      <ul className="text-xs text-muted-foreground list-disc list-inside mt-2 space-y-1">
                        <li>Adobe Acrobat with CAC/PIV</li>
                        <li>DoD PKI certificate</li>
                        <li>Other digital signature tools</li>
                      </ul>
                      {hasDualDigitalSignature && (
                        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-primary/20">
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

    <OfficeCodeLookupModal
      open={officeCodeModalOpen}
      onOpenChange={setOfficeCodeModalOpen}
      onSelect={(code) => setField('officeCode', code)}
    />
    </>
  );
}
