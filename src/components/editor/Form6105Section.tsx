import { ClipboardList, Download, RotateCcw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useFormStore } from '@/stores/formStore';
import { generateNavmc10274Pdf, loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';

export function Form6105Section() {
  const { navmc10274, setNavmc10274Field, resetNavmc10274 } = useFormStore();

  const handleDownload = async () => {
    try {
      // Load the template PDFs
      const templates = await loadNavmc10274Templates();
      
      // Generate the filled PDF
      const pdfBytes = await generateNavmc10274Pdf(
        {
          actionNo: navmc10274.actionNo,
          ssicFileNo: navmc10274.ssicFileNo,
          date: navmc10274.date,
          from: navmc10274.from,
          orgStation: navmc10274.orgStation,
          via: navmc10274.via,
          to: navmc10274.to,
          natureOfAction: navmc10274.natureOfAction,
          copyTo: navmc10274.copyTo,
          references: navmc10274.references,
          enclosures: navmc10274.enclosures,
          supplementalInfo: navmc10274.supplementalInfo,
          proposedAction: navmc10274.proposedAction,
        },
        templates.page1,
        templates.page2,
        templates.page3
      );
      
      // Download
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NAVMC-10274-${navmc10274.date || 'form'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF. Make sure the template files exist in /templates/');
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
          <Button variant="outline" size="sm" onClick={resetNavmc10274}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download PDF
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Administrative Action Form per MCO 5216.19A. Used for counseling, requests, and other administrative actions.
      </p>

      <Accordion type="multiple" defaultValue={['header', 'addressing', 'content']} className="space-y-2">
        {/* Header Section */}
        <AccordionItem value="header" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Header Information</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-4">
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
                <Input
                  id="ssicFileNo"
                  value={navmc10274.ssicFileNo}
                  onChange={(e) => setNavmc10274Field('ssicFileNo', e.target.value)}
                  placeholder="e.g., 1610"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">3. Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={navmc10274.date}
                  onChange={(e) => setNavmc10274Field('date', e.target.value)}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Addressing Section */}
        <AccordionItem value="addressing" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Addressing</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="from">4. From (Grade, Name, EDIPI, MOS, etc.)</Label>
                <Textarea
                  id="from"
                  value={navmc10274.from}
                  onChange={(e) => setNavmc10274Field('from', e.target.value)}
                  placeholder="Originator name and title"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgStation">5. Organization/Station</Label>
                <Textarea
                  id="orgStation"
                  value={navmc10274.orgStation}
                  onChange={(e) => setNavmc10274Field('orgStation', e.target.value)}
                  placeholder="Unit and location"
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="via">6. Via (As required)</Label>
              <Input
                id="via"
                value={navmc10274.via}
                onChange={(e) => setNavmc10274Field('via', e.target.value)}
                placeholder="Chain of command (if applicable)"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">7. To</Label>
              <Textarea
                id="to"
                value={navmc10274.to}
                onChange={(e) => setNavmc10274Field('to', e.target.value)}
                placeholder="Marine's full name, rank, and MOS"
                rows={2}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Content Section */}
        <AccordionItem value="content" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Counseling Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="natureOfAction">8. Nature of Action/Subject</Label>
              <Textarea
                id="natureOfAction"
                value={navmc10274.natureOfAction}
                onChange={(e) => setNavmc10274Field('natureOfAction', e.target.value)}
                placeholder="Brief description of the counseling topic (e.g., 'Formal Counseling - Performance Deficiency')"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplementalInfo">12. Supplemental Information</Label>
              <Textarea
                id="supplementalInfo"
                value={navmc10274.supplementalInfo}
                onChange={(e) => setNavmc10274Field('supplementalInfo', e.target.value)}
                placeholder="Full counseling statement including:
- Specific incident/deficiency description
- Date(s) and location(s)
- Standards violated (cite applicable orders/regulations)
- Prior counseling efforts
- Expected corrective actions
- Consequences of continued deficiency"
                rows={12}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposedAction">13. Proposed/Recommended Action</Label>
              <Textarea
                id="proposedAction"
                value={navmc10274.proposedAction}
                onChange={(e) => setNavmc10274Field('proposedAction', e.target.value)}
                placeholder="e.g., 'Request entry of adverse Page 11 (6105) entry per MCO 1610.7A'"
                rows={3}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* References Section */}
        <AccordionItem value="references" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">References & Distribution</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="references">10. References/Authority</Label>
              <Textarea
                id="references"
                value={navmc10274.references}
                onChange={(e) => setNavmc10274Field('references', e.target.value)}
                placeholder="e.g., MCO 1610.7A, MCO 1070.12K"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="enclosures">11. Enclosures (if any)</Label>
              <Input
                id="enclosures"
                value={navmc10274.enclosures}
                onChange={(e) => setNavmc10274Field('enclosures', e.target.value)}
                placeholder="e.g., (1) Previous counseling dated..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="copyTo">9. Copy To (As required)</Label>
              <Input
                id="copyTo"
                value={navmc10274.copyTo}
                onChange={(e) => setNavmc10274Field('copyTo', e.target.value)}
                placeholder="e.g., Marine's SRB, Company Office"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border rounded-md p-3 text-xs bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
        <div className="text-amber-700 dark:text-amber-400 font-medium mb-1">
          FOR OFFICIAL USE ONLY - Privacy Sensitive
        </div>
        <p className="text-amber-600 dark:text-amber-500">
          Any misuse or unauthorized disclosure can result in both civil and criminal penalties.
        </p>
      </div>
    </div>
  );
}
