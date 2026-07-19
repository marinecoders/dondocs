import { useEffect, useState } from 'react';
import { ClipboardList, RotateCcw, ChevronDown, Trash2, FileText, AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
import { InputWithVariables } from '@/components/ui/variable-autocomplete';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { AbbreviationHelper } from '@/components/editor/AbbreviationHelper';
import { DatePicker } from '@/components/ui/date-picker';
import { useFormStore } from '@/stores/formStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { cn } from '@/lib/utils';
import { NAVMC_118_11_PLACEHOLDERS } from '@/lib/constants';
import { SignatureStylePicker } from './SignatureStylePicker';
import { AddSignatureBlockMenu } from './AddSignatureBlockMenu';
import { SortableSignatureList, SortableSignatureItem } from './SortableSignatureBlocks';
import { arrayMove } from '@dnd-kit/sortable';
import type { FormSignatureBlock } from '@/types/signature';
import { useProfileStore } from '@/stores/profileStore';
import { abbreviatedSignatoryName } from '@/lib/signatoryName';
import { standardSignaturePair } from '@/lib/signaturePresets';
import { showAppConfirm } from '@/stores/alertStore';
import {
  computeNavmc11811Fit,
  type Navmc11811Fit,
} from '@/services/pdf/navmc11811Generator';

/**
 * Per-column "≈ lines used / capacity" readout under a remarks editor. The
 * counts come from the generator's own wrap metrics (computeNavmc11811Fit),
 * so what this says matches what actually prints.
 */
function ColumnFitLine({ fit }: { fit: Navmc11811Fit['left'] | undefined }) {
  if (!fit) return null;
  const over = fit.truncated > 0;
  return (
    <p className={`text-xs ${over ? 'text-destructive' : 'text-muted-foreground'}`}>
      ≈ {fit.lines} of {fit.capacity} printed lines
      {over && ` — ${fit.truncated} won't fit`}
    </p>
  );
}

// Names to sort first in the @ autocomplete. This only reorders entries that
// exist in `placeholders` (NAVMC_118_11_PLACEHOLDERS = NAME, DATE), so any name
// not in that set is inert — keep this list to what the form actually offers.
const COMMON_FORM_VARS = ['NAME', 'DATE'];

// Active-section left-rule for a form AccordionItem, matching the letter
// sections (FormPanel's SectionShell). activeId only changes at section
// boundaries, so this re-renders the form infrequently.
function sectionRule(active: boolean): string {
  return cn(
    'border-l-2 -ml-3 pl-3 transition-colors duration-200',
    active ? 'border-l-muted-foreground/30' : 'border-l-transparent'
  );
}

export function Form11811Section() {
  const { navmc11811, setNavmc11811Field, resetNavmc11811, clearNavmc11811 } = useFormStore();
  // The counselor's initials + SURNAME from the active profile — the counselor
  // is usually the person at the app, so offer their name as a one-click fill
  // (never written silently), the same as the AA form's originator.
  const profileSignatoryName = useProfileStore((s) => {
    const p = s.selectedProfile ? s.profiles[s.selectedProfile] : undefined;
    return p ? abbreviatedSignatoryName(p.sigFirst, p.sigMiddle, p.sigLast) : '';
  });
  const signatureBlocks = navmc11811.signatureBlocks;
  const setSignatureBlock = (index: number, patch: Partial<FormSignatureBlock>) =>
    setNavmc11811Field(
      'signatureBlocks',
      signatureBlocks.map((b, i) => (i === index ? { ...b, ...patch } : b))
    );
  // The counseled Marine's name in the same abbreviated form, derived from the
  // Marine Identification fields this form already collects — so the
  // acknowledgement preset arrives pre-filled instead of asking the user to
  // retype a name that's two sections up.
  const marineAckName = abbreviatedSignatoryName(
    navmc11811.firstName,
    navmc11811.middleName,
    navmc11811.lastName
  );
  // Deleting a filled block loses a statement, a typed name, and possibly an
  // uploaded signature image. Confirm first, same rule as References /
  // Enclosures: an empty block still removes in a single click.
  const removeSignatureBlock = async (index: number) => {
    const b = signatureBlocks[index];
    const hasContent =
      (b?.statement ?? '').trim() !== '' || (b?.name ?? '').trim() !== '' || !!b?.image;
    if (hasContent) {
      const confirmed = await showAppConfirm({
        title: 'Remove signature block?',
        message: `Signature ${index + 1} and its contents will be removed.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setNavmc11811Field('signatureBlocks', signatureBlocks.filter((_, i) => i !== index));
  };
  // Move focus into a block's first input after it's added, so a preset pick
  // flows straight into editing. Double-rAF: the first frame lets React commit
  // the new card, the second runs after the dropdown's close cleanup so its
  // focus handling can't land after ours.
  const focusStatement = (index: number) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(`p11-sig-${index}-statement`)?.focus()
      )
    );
  const activeId = useEditorOutlineStore((s) => s.activeId);

  // Fit report from the generator's own metrics, debounced behind typing. The
  // columns are one physical page — text past a column's capacity is NOT
  // printed, so this is the only thing standing between the user and silent
  // truncation on export.
  const [fit, setFit] = useState<Navmc11811Fit | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      computeNavmc11811Fit(navmc11811).then(
        (f) => !cancelled && setFit(f),
        () => !cancelled && setFit(null)
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [navmc11811]);
  const overflowMessages: string[] = [];
  if (fit) {
    if (fit.left.truncated > 0)
      overflowMessages.push(
        `Left column is full — ${fit.left.truncated} line${fit.left.truncated === 1 ? '' : 's'} won't print. Continue in the right column.`
      );
    if (fit.right.truncated > 0)
      overflowMessages.push(
        `Right column is full — ${fit.right.truncated} line${fit.right.truncated === 1 ? '' : 's'} won't print. Shorten the entry or start a second Page 11.`
      );
    if (fit.left.spillover > 0 && fit.left.truncated === 0)
      overflowMessages.push(
        'The entry date/signature blocks run past the bottom of the left column — shorten the entry or continue it in the right column.'
      );
    if (fit.right.spillover > 0 && fit.right.truncated === 0)
      overflowMessages.push(
        'The signature blocks run past the bottom of the right column — shorten the entry.'
      );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" />
          NAVMC 118(11) - Administrative Remarks
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
              <DropdownMenuItem onClick={resetNavmc11811}>
                <FileText className="h-4 w-4 mr-2" />
                Reset to Example
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearNavmc11811}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Page 11 Entry (6105 Counseling) per MCO 1610.7A. Used for documenting formal counseling,
        adverse administrative remarks, and other official entries.
      </p>

      <Accordion type="multiple" className="space-y-2">
        {/* Marine Identification */}
        <AccordionItem value="marine" id="sec-marine" data-section="marine" className={sectionRule(activeId === 'marine')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Marine Identification</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <InputWithVariables
                  id="lastName"
                  value={navmc11811.lastName}
                  onValueChange={(v) => setNavmc11811Field('lastName', v)}
                  placeholder="DOE (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <InputWithVariables
                  id="firstName"
                  value={navmc11811.firstName}
                  onValueChange={(v) => setNavmc11811Field('firstName', v)}
                  placeholder="JOHN (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName">Middle Name</Label>
                <InputWithVariables
                  id="middleName"
                  value={navmc11811.middleName}
                  onValueChange={(v) => setNavmc11811Field('middleName', v)}
                  placeholder="ADAM (type @ for variables)"
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edipi">EDIPI</Label>
                <InputWithVariables
                  id="edipi"
                  value={navmc11811.edipi}
                  onValueChange={(v) => setNavmc11811Field('edipi', v)}
                  placeholder="1234567890 (type @ for variables)"
                  maxLength={10}
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entryDate">Entry Date</Label>
                {/* DatePicker for military date format ("15 Dec 24") per
                    SECNAV M-5216.5 / MCO 1070.12K. It accepts ISO on input,
                    so old ISO-format values reformat on first edit. */}
                <DatePicker
                  id="entryDate"
                  value={navmc11811.entryDate}
                  onChange={(value) => setNavmc11811Field('entryDate', value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="box11">SRB Pg #</Label>
                <InputWithVariables
                  id="box11"
                  value={navmc11811.box11}
                  onValueChange={(v) => setNavmc11811Field('box11', v)}
                  placeholder="Page # (type @)"
                  maxLength={5}
                  placeholders={NAVMC_118_11_PLACEHOLDERS}
                  commonVariables={COMMON_FORM_VARS}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Entry Content */}
        <AccordionItem value="content" id="sec-content" data-section="content" className={sectionRule(activeId === 'content')}>
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">6105 Entry Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="remarksText">Administrative Remarks (Left)</Label>
                <VariableChipEditor
                  value={navmc11811.remarksText}
                  onChange={(v) => setNavmc11811Field('remarksText', v)}
                  placeholder="Type @ or click + for variables. Example: On {{ENTRY_DATE}}, {{NAME}} [describe the incident]…"
                  rows={16}
                  tabInsertsSpaces
                />
                <ColumnFitLine fit={fit?.left} />
                <AbbreviationHelper
                  value={navmc11811.remarksText}
                  onChange={(v) => setNavmc11811Field('remarksText', v)}
                  formType="navmc_11811"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remarksTextRight">Administrative Remarks (Right)</Label>
                <VariableChipEditor
                  value={navmc11811.remarksTextRight || ''}
                  onChange={(v) => setNavmc11811Field('remarksTextRight', v)}
                  placeholder="[Continuation or additional entry…] (type @ or click + for variables)"
                  rows={16}
                  tabInsertsSpaces
                />
                <ColumnFitLine fit={fit?.right} />
                <AbbreviationHelper
                  value={navmc11811.remarksTextRight || ''}
                  onChange={(v) => setNavmc11811Field('remarksTextRight', v)}
                  formType="navmc_11811"
                />
              </div>
            </div>
            {overflowMessages.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                <div className="space-y-1 text-warning">
                  {overflowMessages.map((m) => (
                    <p key={m}>{m}</p>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Include: incident description, date/location, standards violated, prior counseling (if any),
              expected corrective actions, and consequences of continued deficiency.
              The form is a single page — text does not flow between columns, and
              anything past a column&apos;s last printed line is left off the PDF.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* Signatures — close the 6105 entry (counselor + counseled Marine) */}
        <AccordionItem value="signatures" id="sec-signatures" data-section="signatures" className={sectionRule(activeId === 'signatures')}>
          <AccordionTrigger>Signatures</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-1">
              <p className="text-xs text-muted-foreground">
                A Page 11 entry is authenticated by the counselor and the
                counseled Marine (MCO 1610.7 / IRAM). Each block prints at the
                end of the entry text, top-to-bottom in the order below; drag a
                block&apos;s handle to rearrange. Type the acknowledgement
                wording your command uses.
              </p>
              <SortableSignatureList
                count={signatureBlocks.length}
                className="space-y-4"
                onReorder={(oldIndex, newIndex) =>
                  setNavmc11811Field('signatureBlocks', arrayMove(signatureBlocks, oldIndex, newIndex))
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
                          Signature {index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove signature block ${index + 1}`}
                          onClick={() => removeSignatureBlock(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <InputWithVariables
                        id={`p11-sig-${index}-statement`}
                        value={block.statement}
                        onValueChange={(v) => setSignatureBlock(index, { statement: v })}
                        placeholder="Statement above the signing line (e.g. I have been counseled…)"
                        placeholders={NAVMC_118_11_PLACEHOLDERS}
                        commonVariables={COMMON_FORM_VARS}
                      />
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <InputWithVariables
                            value={block.name}
                            onValueChange={(v) => setSignatureBlock(index, { name: v })}
                            placeholder="Typed name (e.g. A. B. SMITH)"
                            placeholders={NAVMC_118_11_PLACEHOLDERS}
                            commonVariables={COMMON_FORM_VARS}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          disabled={!profileSignatoryName}
                          onClick={() => setSignatureBlock(index, { name: profileSignatoryName })}
                          title={profileSignatoryName ? `Use ${profileSignatoryName}` : 'No profile signature to use'}
                        >
                          Use profile
                        </Button>
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
              <div className="flex flex-wrap gap-2">
                <AddSignatureBlockMenu
                  form="navmc_118_11"
                  names={{ signer: profileSignatoryName, marine: marineAckName }}
                  onAdd={(b) => {
                    const index = signatureBlocks.length;
                    setNavmc11811Field('signatureBlocks', [...signatureBlocks, b]);
                    // Returned to the menu: it runs this on close, after its
                    // exit animation, so the focus can't be clobbered.
                    return () => focusStatement(index);
                  }}
                />
                {signatureBlocks.length === 0 && (
                  /* One click sets up the standard pair — counselor from the
                     profile, the Marine from the identification fields above. */
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNavmc11811Field(
                        'signatureBlocks',
                        standardSignaturePair('navmc_118_11', {
                          signer: profileSignatoryName,
                          marine: marineAckName,
                        })
                      );
                      focusStatement(0);
                    }}
                  >
                    Add counselor + Marine acknowledgement
                  </Button>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border-l-2 pl-3 text-xs border-amber-400 dark:border-amber-600">
        <div className="text-amber-700 dark:text-amber-400 font-medium mb-1">
          FOUO - Privacy Sensitive When Filled In
        </div>
        <p className="text-amber-600 dark:text-amber-500">
          This form contains personally identifiable information (PII) and is For Official Use Only. 
          Ensure proper handling and storage per DoD Privacy Act guidelines.
        </p>
      </div>
    </div>
  );
}
