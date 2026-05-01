import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useDocumentStore } from '@/stores/documentStore';

export function JointMemoSection() {
  const { formData, setField } = useDocumentStore();

  return (
    <>
      {/* Joint Memorandum Info */}
      <Accordion type="single" collapsible defaultValue="joint-memo-info">
        <AccordionItem value="joint-memo-info">
          <AccordionTrigger>Joint Memorandum</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium">Per SECNAV M-5216.5 Ch 12:</p>
                <p className="text-xs mt-1">
                  A joint memorandum is signed by two officials presenting a unified position.
                  Both signatories appear side-by-side at the bottom.
                </p>
              </div>

              {/* Date */}
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <DatePicker
                  id="date"
                  value={formData.date || ''}
                  onChange={(value) => setField('date', value)}
                  placeholder="15 Jan 26"
                />
              </div>

              {/* To */}
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input
                  id="to"
                  value={formData.to || ''}
                  onChange={(e) => setField('to', e.target.value)}
                  placeholder="e.g., Commandant of the Marine Corps"
                />
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={formData.subject || ''}
                  onChange={(e) => setField('subject', e.target.value)}
                  placeholder="SUBJECT LINE IN ALL CAPS"
                  className="uppercase"
                />
                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox
                    id="underlineSubjectJoint"
                    checked={formData.underlineSubject || false}
                    onCheckedChange={(checked) => setField('underlineSubject', !!checked)}
                  />
                  <Label htmlFor="underlineSubjectJoint" className="text-sm font-normal cursor-pointer">
                    Underline subject line
                  </Label>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Senior Signatory (Right Side) */}
      <Accordion type="single" collapsible defaultValue="senior-sig">
        <AccordionItem value="senior-sig">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Senior Signatory</span>
              <span className="text-xs text-muted-foreground font-normal">(Right Side)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="jointMemoSeniorFrom">From/Position</Label>
                <Input
                  id="jointMemoSeniorFrom"
                  value={formData.jointMemoSeniorFrom || ''}
                  onChange={(e) => setField('jointMemoSeniorFrom', e.target.value)}
                  placeholder="e.g., Deputy Commandant for Plans, Policies, and Operations"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointMemoSeniorSigName">Full Name</Label>
                <Input
                  id="jointMemoSeniorSigName"
                  value={formData.jointMemoSeniorSigName || ''}
                  onChange={(e) => setField('jointMemoSeniorSigName', e.target.value)}
                  placeholder="J. A. SMITH"
                  className="uppercase"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointMemoSeniorSigTitle">Title</Label>
                <Textarea
                  id="jointMemoSeniorSigTitle"
                  value={formData.jointMemoSeniorSigTitle || ''}
                  onChange={(e) => setField('jointMemoSeniorSigTitle', e.target.value)}
                  placeholder="Lieutenant General, U.S. Marine Corps"
                  rows={2}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Junior Signatory (Left Side) */}
      <Accordion type="single" collapsible defaultValue="junior-sig">
        <AccordionItem value="junior-sig">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <span>Junior Signatory</span>
              <span className="text-xs text-muted-foreground font-normal">(Left Side)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="jointMemoJuniorFrom">From/Position</Label>
                <Input
                  id="jointMemoJuniorFrom"
                  value={formData.jointMemoJuniorFrom || ''}
                  onChange={(e) => setField('jointMemoJuniorFrom', e.target.value)}
                  placeholder="e.g., Deputy Commandant for Installations and Logistics"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointMemoJuniorSigName">Full Name</Label>
                <Input
                  id="jointMemoJuniorSigName"
                  value={formData.jointMemoJuniorSigName || ''}
                  onChange={(e) => setField('jointMemoJuniorSigName', e.target.value)}
                  placeholder="T. R. JONES"
                  className="uppercase"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jointMemoJuniorSigTitle">Title</Label>
                <Textarea
                  id="jointMemoJuniorSigTitle"
                  value={formData.jointMemoJuniorSigTitle || ''}
                  onChange={(e) => setField('jointMemoJuniorSigTitle', e.target.value)}
                  placeholder="Lieutenant General, U.S. Marine Corps"
                  rows={2}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
