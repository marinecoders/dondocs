import { FileText, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';

/**
 * Executive Memo Section — used for standard_memorandum, action_memorandum, information_memorandum
 *
 * Per SECNAV M-5216.5 Ch 12:
 * - Standard Memo: MEMORANDUM FOR addressee, optional ATTN/THROUGH, SUBJECT in Title Case
 * - Action Memo: FOR/FROM/SUBJECT, RECOMMENDATION, COORDINATION, Attachments, Prepared By
 * - Info Memo: FOR/FROM/SUBJECT, COORDINATION, Attachments, Prepared By (no signature block)
 */
export function ExecutiveMemoSection() {
  const { formData, setField, docType } = useDocumentStore();

  const isActionMemo = docType === 'action_memorandum';
  const isInfoMemo = docType === 'information_memorandum';
  const isStandardMemo = docType === 'standard_memorandum';

  // Descriptive labels and guidance per Ch 12 section
  const memoTypeLabel = isActionMemo
    ? 'Action Memorandum'
    : isInfoMemo
      ? 'Information Memorandum'
      : 'Standard Memorandum (HqDON)';

  const memoDescription = isActionMemo
    ? 'Forwarding material that requires SecDef, DepSecDef, or HqDON approval/signature, or describing a problem and recommending a solution.'
    : isInfoMemo
      ? 'Conveys information on important developments not requiring action. Sending official signs and dates on the FROM line.'
      : 'Standard HqDON/OSD correspondence format. MEMORANDUM FOR addressing, Title Case subject, 12pt Times New Roman required.';

  return (
    <Accordion type="single" collapsible defaultValue="exec-addressing">
      <AccordionItem value="exec-addressing">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {memoTypeLabel}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Informational banner */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium">Per SECNAV M-5216.5 Ch 12:</p>
              <p className="text-xs mt-1">{memoDescription}</p>
              {isInfoMemo && (
                <p className="text-xs mt-1 font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  Info Memos have no signature block — the sending official signs on the FROM line.
                </p>
              )}
            </div>

            {/* Date — spelled format per Ch 12 */}
            <div className="space-y-2">
              <Label htmlFor="exec-date" className="text-sm font-medium">
                Date <span className="text-destructive">*</span>
              </Label>
              <DatePicker
                value={formData.date || ''}
                onChange={(value) => setField('date', value)}
                dateFormat="spelled"
                placeholder="January 5, 2026"
              />
              <p className="text-xs text-muted-foreground">Spelled format per Ch 12 (e.g., January 5, 2026)</p>
            </div>

            {/* MEMORANDUM FOR / FOR: addressee */}
            <div className="space-y-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor="exec-memo-for" className="text-sm font-medium cursor-help">
                      {isActionMemo || isInfoMemo ? 'FOR:' : 'MEMORANDUM FOR:'}{' '}
                      <span className="text-destructive">*</span>
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-[300px]">
                      {isStandardMemo
                        ? 'Per Ch 12 ¶2i: Include title and office symbol. If multi-line, indent second line 2 additional spaces.'
                        : 'Per Ch 12 ¶3: Addressee for the memorandum.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Textarea
                id="exec-memo-for"
                value={formData.memorandumFor || ''}
                onChange={(e) => setField('memorandumFor', e.target.value)}
                placeholder={isStandardMemo
                  ? 'Secretary of the Navy\nATTN: Office of the Judge Advocate General (Code 10)'
                  : 'Secretary of the Navy'}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* ATTN: line (Standard Memo only) */}
            {isStandardMemo && (
              <div className="space-y-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor="exec-attn" className="text-sm font-medium cursor-help">
                        ATTN: <span className="text-muted-foreground text-xs">(optional)</span>
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-[300px]">
                        Per Ch 12 ¶2j: Type "ATTN:" followed by name or title in parentheses, placed single space below address line.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Input
                  id="exec-attn"
                  value={formData.attnLine || ''}
                  onChange={(e) => setField('attnLine', e.target.value)}
                  placeholder="Office of the General Counsel"
                />
              </div>
            )}

            {/* THROUGH: line (Standard Memo only) */}
            {isStandardMemo && (
              <div className="space-y-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor="exec-through" className="text-sm font-medium cursor-help">
                        THROUGH: <span className="text-muted-foreground text-xs">(optional)</span>
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-[300px]">
                        Per Ch 12 ¶2k: Type the THROUGH office in ALL CAPS. Avoid using THROUGH when addressing to SecDef, DepSecDef, SECNAV, or UNSECNAV.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Input
                  id="exec-through"
                  value={formData.throughLine || ''}
                  onChange={(e) => setField('throughLine', e.target.value)}
                  placeholder="ASSISTANT SECRETARY OF THE NAVY (MANPOWER AND RESERVE AFFAIRS)"
                  className="uppercase"
                />
              </div>
            )}

            {/* FROM: line (Action/Info memos, and optionally Standard) */}
            <div className="space-y-2">
              <Label htmlFor="exec-from" className="text-sm font-medium">
                FROM: {(isActionMemo || isInfoMemo) && <span className="text-destructive">*</span>}
                {isStandardMemo && <span className="text-muted-foreground text-xs">(optional)</span>}
              </Label>
              <Input
                id="exec-from"
                value={formData.from || ''}
                onChange={(e) => setField('from', e.target.value)}
                placeholder={isInfoMemo
                  ? 'Under Secretary of the Navy (signed and dated here)'
                  : 'Assistant Secretary of the Navy (Manpower and Reserve Affairs)'}
              />
              {isInfoMemo && (
                <p className="text-xs text-muted-foreground">
                  Per Ch 12 ¶4a(3): Sending official signs and dates on the FROM line.
                </p>
              )}
            </div>

            {/* SUBJECT: — Title Case per Ch 12 ¶2l (NOT ALL CAPS) */}
            <div className="space-y-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor="exec-subject" className="text-sm font-medium cursor-help">
                      SUBJECT: <span className="text-destructive">*</span>
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-[300px]">
                      Per Ch 12 ¶2l: Capitalize first word and all principal words (Title Case, NOT ALL CAPS). Succeeding lines aligned below first word.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Input
                id="exec-subject"
                value={formData.subject || ''}
                onChange={(e) => setField('subject', e.target.value)}
                placeholder="Quarterly Report on Personnel Readiness"
              />
              <p className="text-xs text-muted-foreground">
                Title Case per Ch 12 ¶2l (not ALL CAPS like standard correspondence)
              </p>
            </div>

            {/* COORDINATION (Action/Info memos) */}
            {(isActionMemo || isInfoMemo) && (
              <div className="space-y-2">
                <Label htmlFor="exec-coordination" className="text-sm font-medium">
                  COORDINATION: <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Textarea
                  id="exec-coordination"
                  value={formData.coordination || ''}
                  onChange={(e) => setField('coordination', e.target.value)}
                  placeholder="ASN (M&RA), General Counsel, CHINFO"
                  rows={2}
                  className="resize-none"
                />
              </div>
            )}

            {/* Prepared By (Action/Info memos) */}
            {(isActionMemo || isInfoMemo) && (
              <div className="space-y-2">
                <Label htmlFor="exec-prepared-by" className="text-sm font-medium">
                  Prepared By: <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Input
                  id="exec-prepared-by"
                  value={formData.preparedBy || ''}
                  onChange={(e) => setField('preparedBy', e.target.value)}
                  placeholder="CAPT J. Smith, OJAG (Code 13), (703) 614-1234"
                />
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
