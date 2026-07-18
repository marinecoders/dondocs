import { useState } from 'react';
import { ClipboardList, RotateCcw, ChevronDown, Trash2, FileText } from 'lucide-react';
import { BookOpen, Building2, Library } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconTip } from '@/components/ui/icon-tip';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { InputWithVariables, TextareaWithVariables } from '@/components/ui/variable-autocomplete';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { DatePicker } from '@/components/ui/date-picker';
import { useFormStore } from '@/stores/formStore';
import { useProfileStore } from '@/stores/profileStore';
import { abbreviatedSignatoryName } from '@/lib/signatoryName';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { FormReferenceLibraryModal } from '@/components/modals/FormReferenceLibraryModal';
import { NAVMC_10274_PLACEHOLDERS } from '@/lib/constants';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { cn } from '@/lib/utils';
import type { UnitInfo } from '@/data/unitDirectory';
import type { FormSignatureBlock } from '@/types/signature';
import { SignatureStylePicker } from './SignatureStylePicker';
import { AddSignatureBlockMenu } from './AddSignatureBlockMenu';
import { SortableSignatureList, SortableSignatureItem } from './SortableSignatureBlocks';
import { arrayMove } from '@dnd-kit/sortable';
import { standardSignaturePair } from '@/lib/signaturePresets';
import { showAppConfirm } from '@/stores/alertStore';

// Active-section left-rule for a form AccordionItem, matching the letter
// sections (FormPanel's SectionShell). activeId only changes at section
// boundaries, so this re-renders the form infrequently.
function sectionRule(active: boolean): string {
  return cn(
    'border-l-2 -ml-3 pl-3 transition-colors duration-200',
    active ? 'border-l-muted-foreground/30' : 'border-l-transparent'
  );
}

// Names to sort first in the @ autocomplete. This only reorders entries that
// exist in `placeholders` (NAVMC_10274_PLACEHOLDERS = NAME, DATE), so any name
// not in that set is inert — keep this list to what the form actually offers.
const COMMON_FORM_VARS = ['NAME', 'DATE'];

export function Form6105Section() {
  const { navmc10274, setNavmc10274Field, resetNavmc10274, clearNavmc10274, includeCoverPage, setIncludeCoverPage } = useFormStore();
  const activeId = useEditorOutlineStore((s) => s.activeId);

  // The active profile's signature name in the abbreviated form signature
  // blocks use (initials + SURNAME), offered as a one-click fill for the
  // originator — never written silently.
  const profileOriginatorName = useProfileStore((s) => {
    const p = s.selectedProfile ? s.profiles[s.selectedProfile] : undefined;
    return p ? abbreviatedSignatoryName(p.sigFirst, p.sigMiddle, p.sigLast) : '';
  });
  // Block 4 "From" in the form's own style ("SSgt John A. Smith") — rank +
  // full first name + middle initial + last, from the profile. The profile
  // doesn't hold EDIPI/MOS, so the user appends those; still one click for
  // the part the app knows. Never written silently.
  const profileFromLine = useProfileStore((s) => {
    const p = s.selectedProfile ? s.profiles[s.selectedProfile] : undefined;
    if (!p) return '';
    const first = (p.sigFirst ?? '').trim();
    // Positional, like abbreviatedSignatoryName: no first ⇒ no middle initial.
    const middle = first ? (p.sigMiddle ?? '').trim().charAt(0) : '';
    const name = [first, middle && `${middle.toUpperCase()}.`, (p.sigLast ?? '').trim()]
      .filter(Boolean)
      .join(' ');
    return [(p.sigRank ?? '').trim(), name].filter(Boolean).join(' ');
  });
  // Block 5 "Organization/Station" from the profile's unit — the same shape
  // the unit-directory picker writes (name lines, then address).
  const profileOrgStation = useProfileStore((s) => {
    const p = s.selectedProfile ? s.profiles[s.selectedProfile] : undefined;
    return p ? [p.unitLine1, p.unitLine2, p.unitAddress].map((l) => (l ?? '').trim()).filter(Boolean).join('\n') : '';
  });
  const signatureBlocks = navmc10274.signatureBlocks;
  const setSignatureBlock = (index: number, patch: Partial<FormSignatureBlock>) => {
    setNavmc10274Field(
      'signatureBlocks',
      signatureBlocks.map((b, i) => (i === index ? { ...b, ...patch } : b))
    );
  };
  // Deleting a filled block loses a statement, a typed name, and possibly an
  // uploaded signature image — and deleting block 1 silently promotes the next
  // block to originator. Confirm first, same rule as References/Enclosures:
  // an empty block still removes in a single click.
  const removeSignatureBlock = async (index: number) => {
    const b = signatureBlocks[index];
    const hasContent =
      (b?.statement ?? '').trim() !== '' || (b?.name ?? '').trim() !== '' || !!b?.image;
    if (hasContent) {
      const promote =
        index === 0 && signatureBlocks.length > 1
          ? ' The next block becomes the originator.'
          : '';
      const confirmed = await showAppConfirm({
        title: 'Remove signature block?',
        message: `${index === 0 ? 'The originator block' : `Signature ${index + 1}`} and its contents will be removed.${promote}`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setNavmc10274Field(
      'signatureBlocks',
      signatureBlocks.filter((_, i) => i !== index)
    );
  };
  // Move focus into a block's first input after it's added, so a preset pick
  // flows straight into editing. Double-rAF: the first frame lets React commit
  // the new card, the second runs after the dropdown's close cleanup so its
  // focus handling can't land after ours.
  const focusStatement = (index: number) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(`aa-sig-${index}-statement`)?.focus()
      )
    );
  const fillOriginatorFromProfile = () => {
    if (!profileOriginatorName) return;
    if (signatureBlocks.length === 0) {
      setNavmc10274Field('signatureBlocks', [{ statement: '', name: profileOriginatorName }]);
    } else {
      setSignatureBlock(0, { name: profileOriginatorName });
    }
  };

  // Modal states
  const [ssicModalOpen, setSSICModalOpen] = useState(false);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);

  const handleSSICSelect = (code: string) => {
    setNavmc10274Field('ssicFileNo', code);
  };

  const handleUnitSelect = (unit: UnitInfo) => {
    // Format unit info for the Organization/Station field
    const unitText = [
      unit.name,
      unit.address,
    ].filter(Boolean).join('\n');
    setNavmc10274Field('orgStation', unitText);
  };

  const handleReferenceSelect = (reference: string) => {
    // Add reference to existing references with proper lettering
    const currentRefs = navmc10274.references.trim();
    if (!currentRefs) {
      setNavmc10274Field('references', `(a) ${reference}`);
    } else {
      // Count existing references to determine next letter
      const refLines = currentRefs.split('\n').filter(line => line.trim());
      const nextLetter = String.fromCharCode(97 + refLines.length); // a=97, b=98, etc.
      setNavmc10274Field('references', `${currentRefs}\n(${nextLetter}) ${reference}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" />
          NAVMC 10274 - Administrative Action
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={resetNavmc10274}>
                <FileText className="h-4 w-4 mr-2" />
                Reset to Example
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearNavmc10274}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Administrative Action Form per MCO 5216.19A. Used for counseling, requests, and other administrative actions.
      </p>

      {/* Options */}
      <div className="flex items-center gap-2 px-1">
        <Checkbox
          id="includeCoverPage"
          checked={includeCoverPage}
          onCheckedChange={(checked) => setIncludeCoverPage(checked === true)}
        />
        <Label htmlFor="includeCoverPage" className="text-sm cursor-pointer">
          Include Privacy Act cover page
        </Label>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {/* Header Section */}
        <AccordionItem value="header" id="sec-header" data-section="header" className={sectionRule(activeId === 'header')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Header Information</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="actionNo">1. Action No.</Label>
                <Input
                  id="actionNo"
                  value={navmc10274.actionNo}
                  onChange={(e) => setNavmc10274Field('actionNo', e.target.value)}
                  placeholder="e.g., 001-25"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ssicFileNo">2. SSIC/File No.</Label>
                <div className="flex gap-1">
                  <Input
                    id="ssicFileNo"
                    value={navmc10274.ssicFileNo}
                    onChange={(e) => setNavmc10274Field('ssicFileNo', e.target.value)}
                    placeholder="e.g., 1610"
                  />
                  <IconTip label="Browse SSIC codes">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setSSICModalOpen(true)}
                    >
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </IconTip>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">3. Date</Label>
                {/* DatePicker for military date format ("15 Dec 24") per
                    SECNAV M-5216.5 / MCO 1070.12K. It accepts ISO on input,
                    so old ISO-format values reformat on first edit. */}
                <DatePicker
                  id="date"
                  value={navmc10274.date}
                  onChange={(value) => setNavmc10274Field('date', value)}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Addressing Section */}
        <AccordionItem value="addressing" id="sec-addressing" data-section="addressing" className={sectionRule(activeId === 'addressing')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Addressing</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="from">4. From (Grade, Name, EDIPI, MOS, etc.)</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setNavmc10274Field('from', profileFromLine)}
                    disabled={!profileFromLine}
                    title={profileFromLine ? `Use ${profileFromLine}` : 'No profile name to use'}
                  >
                    Use profile
                  </Button>
                </div>
                <TextareaWithVariables
                  id="from"
                  value={navmc10274.from}
                  onValueChange={(v) => setNavmc10274Field('from', v)}
                  placeholder="Originator name and title (type @ for variables)"
                  rows={2}
                  placeholders={NAVMC_10274_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="orgStation">5. Organization/Station</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setNavmc10274Field('orgStation', profileOrgStation)}
                    disabled={!profileOrgStation}
                    title={profileOrgStation ? 'Use your profile unit' : 'No profile unit to use'}
                  >
                    Use profile
                  </Button>
                </div>
                <div className="flex gap-1">
                  <TextareaWithVariables
                    id="orgStation"
                    value={navmc10274.orgStation}
                    onValueChange={(v) => setNavmc10274Field('orgStation', v)}
                    placeholder="Unit and location (type @ for variables)"
                    rows={2}
                    className="flex-1"
                    placeholders={NAVMC_10274_PLACEHOLDERS}
                    commonVariables={COMMON_FORM_VARS}
                  />
                  <IconTip label="Browse unit directory">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setUnitModalOpen(true)}
                      className="h-auto self-stretch"
                    >
                      <Building2 className="h-4 w-4" />
                    </Button>
                  </IconTip>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="via">6. Via (As required)</Label>
              <InputWithVariables
                id="via"
                value={navmc10274.via}
                onValueChange={(v) => setNavmc10274Field('via', v)}
                placeholder="Chain of command (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">7. To</Label>
              <TextareaWithVariables
                id="to"
                value={navmc10274.to}
                onValueChange={(v) => setNavmc10274Field('to', v)}
                placeholder="Marine's full name, rank, and MOS (type @ for variables)"
                rows={2}
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Content Section */}
        <AccordionItem value="content" id="sec-content" data-section="content" className={sectionRule(activeId === 'content')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Counseling Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="natureOfAction">8. Nature of Action/Subject</Label>
              <TextareaWithVariables
                id="natureOfAction"
                value={navmc10274.natureOfAction}
                onValueChange={(v) => setNavmc10274Field('natureOfAction', v)}
                placeholder="Brief description (type @ for variables)"
                rows={2}
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplementalInfo">12. Supplemental Information</Label>
              <VariableChipEditor
                value={navmc10274.supplementalInfo}
                onChange={(v) => setNavmc10274Field('supplementalInfo', v)}
                placeholder="Full counseling statement (type @ or click + for variables)…"
                rows={12}
                tabInsertsSpaces
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposedAction">Proposed/Recommended Action</Label>
              <VariableChipEditor
                value={navmc10274.proposedAction}
                onChange={(v) => setNavmc10274Field('proposedAction', v)}
                placeholder="e.g., 'Request entry of adverse Page 11 (6105) entry per MCO 1610.7A' (type @ or click + for variables)"
                rows={3}
                tabInsertsSpaces
              />
              <p className="text-xs text-muted-foreground">
                The printed form has no box for this — it closes out block 12 as
                its own labeled paragraph.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Signatures Section — block 12 closes with the originator's typed
            name signed 3 lines below the text (printed on the form itself); a
            counseling action typically adds the Marine's acknowledgement as a
            second block, and sometimes a witness as a third. */}
        <AccordionItem value="signatures" id="sec-signatures" data-section="signatures" className={sectionRule(activeId === 'signatures')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Signatures</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Signature blocks</Label>
                <AddSignatureBlockMenu
                  form="navmc_10274"
                  disabled={signatureBlocks.length >= 4}
                  names={{ signer: profileOriginatorName }}
                  onAdd={(b) => {
                    const index = signatureBlocks.length;
                    setNavmc10274Field('signatureBlocks', [...signatureBlocks, b]);
                    // Returned to the menu: it runs this on close, after its
                    // exit animation, so the focus can't be clobbered.
                    return () => focusStatement(index);
                  }}
                />
              </div>
              {signatureBlocks.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    No signature blocks — block 12 ends with the text. The form
                    expects at least the originator&apos;s.
                  </p>
                  {/* One click sets up the standard counseling pair, with the
                      originator pre-filled from the profile when there is one. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNavmc10274Field(
                        'signatureBlocks',
                        standardSignaturePair('navmc_10274', { signer: profileOriginatorName })
                      );
                      focusStatement(0);
                    }}
                  >
                    Add originator + Marine acknowledgement
                  </Button>
                </div>
              )}
              <SortableSignatureList
                count={signatureBlocks.length}
                className="space-y-2"
                onReorder={(oldIndex, newIndex) =>
                  setNavmc10274Field('signatureBlocks', arrayMove(signatureBlocks, oldIndex, newIndex))
                }
              >
                {signatureBlocks.map((block, index) => (
                  <SortableSignatureItem
                    key={index}
                    index={index}
                    label={`signature block ${index + 1}`}
                    showHandle={signatureBlocks.length > 1}
                  >
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          {index === 0 ? 'Originator' : `Signature ${index + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSignatureBlock(index)}
                          aria-label={`Remove signature block ${index + 1}`}
                          className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <Input
                        id={`aa-sig-${index}-statement`}
                        value={block.statement}
                        onChange={(e) => setSignatureBlock(index, { statement: e.target.value })}
                        placeholder={
                          index === 0
                            ? 'Statement above the signature (optional)'
                            : 'e.g., I acknowledge receipt and understanding of this counseling.'
                        }
                        aria-label={`Signature block ${index + 1} statement`}
                      />
                      <div className="flex gap-2">
                        <Input
                          value={block.name}
                          onChange={(e) => setSignatureBlock(index, { name: e.target.value })}
                          placeholder="R. L. SMITH"
                          aria-label={`Signature block ${index + 1} typed name`}
                        />
                        {index === 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 self-center"
                            onClick={fillOriginatorFromProfile}
                            disabled={!profileOriginatorName}
                            title={profileOriginatorName ? `Use ${profileOriginatorName}` : 'No profile signature to use'}
                          >
                            Use profile
                          </Button>
                        )}
                      </div>
                      <SignatureStylePicker
                        block={block}
                        index={index}
                        onChange={(patch) => setSignatureBlock(index, patch)}
                      />
                    </div>
                  </SortableSignatureItem>
                ))}
              </SortableSignatureList>
              <p className="text-xs text-muted-foreground">
                Drag the handle to reorder — blocks print top-to-bottom in this
                order, and the top block signs as the originator. Each typed
                name prints on the third line below what precedes it — the
                space above is where that person signs, per the form&apos;s
                caption. Statements print as a paragraph above their signature.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* References Section */}
        <AccordionItem value="references" id="sec-references" data-section="references" className={sectionRule(activeId === 'references')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">References & Distribution</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="references">10. References/Authority</Label>
              <div className="flex gap-1">
                <TextareaWithVariables
                  id="references"
                  value={navmc10274.references}
                  onValueChange={(v) => setNavmc10274Field('references', v)}
                  placeholder="e.g., MCO 1610.7A, MCO 1070.12K (type @ for variables)"
                  rows={2}
                  className="flex-1"
                  placeholders={NAVMC_10274_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
                <IconTip label="Browse reference library">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setReferenceModalOpen(true)}
                    className="h-auto self-stretch"
                  >
                    <Library className="h-4 w-4" />
                  </Button>
                </IconTip>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="enclosures">11. Enclosures (if any)</Label>
              <InputWithVariables
                id="enclosures"
                value={navmc10274.enclosures}
                onValueChange={(v) => setNavmc10274Field('enclosures', v)}
                placeholder="e.g., (1) Previous counseling dated… (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="copyTo">9. Copy To (As required)</Label>
              <InputWithVariables
                id="copyTo"
                value={navmc10274.copyTo}
                onValueChange={(v) => setNavmc10274Field('copyTo', v)}
                placeholder="e.g., Marine's SRB, Company Office (type @ for variables)"
                placeholders={NAVMC_10274_PLACEHOLDERS}
                commonVariables={COMMON_FORM_VARS}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border-l-2 pl-3 text-xs border-amber-400 dark:border-amber-600">
        <div className="text-amber-700 dark:text-amber-400 font-medium mb-1">
          FOR OFFICIAL USE ONLY - Privacy Sensitive
        </div>
        <p className="text-amber-600 dark:text-amber-500">
          Any misuse or unauthorized disclosure can result in both civil and criminal penalties.
        </p>
      </div>

      {/* Modals */}
      <SSICLookupModal
        open={ssicModalOpen}
        onOpenChange={setSSICModalOpen}
        onSelect={handleSSICSelect}
      />

      <UnitLookupModal
        open={unitModalOpen}
        onOpenChange={setUnitModalOpen}
        onSelect={handleUnitSelect}
      />

      <FormReferenceLibraryModal
        open={referenceModalOpen}
        onOpenChange={setReferenceModalOpen}
        onSelect={handleReferenceSelect}
      />
    </div>
  );
}
