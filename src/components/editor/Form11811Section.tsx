import { ClipboardList, Download, RotateCcw, ChevronDown, Trash2, FileText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { useFormStore } from '@/stores/formStore';
import { generateNavmc11811Pdf, loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';

export function Form11811Section() {
  const { navmc11811, setNavmc11811Field, resetNavmc11811, clearNavmc11811 } = useFormStore();

  const handleDownload = async () => {
    try {
      // Load the template PDF
      const templateBytes = await loadNavmc11811Template();
      
      // Generate the filled PDF
      const pdfBytes = await generateNavmc11811Pdf({
        lastName: navmc11811.lastName,
        firstName: navmc11811.firstName,
        middleName: navmc11811.middleName,
        edipi: navmc11811.edipi,
        remarksText: navmc11811.remarksText,
        entryDate: navmc11811.entryDate,
        box11: navmc11811.box11,
      }, templateBytes);
      
      // Download
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const lastName = navmc11811.lastName || 'Marine';
      a.download = `NAVMC-118-11-${lastName}-${navmc11811.entryDate || 'entry'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF. Make sure the template file exists at /templates/NAVMC118_template.pdf');
    }
  };

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
          <Button size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download PDF
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Page 11 Entry (6105 Counseling) per MCO 1610.7A. Used for documenting formal counseling, 
        adverse administrative remarks, and other official entries.
      </p>

      <Accordion type="multiple" defaultValue={['marine', 'content']} className="space-y-2">
        {/* Marine Identification */}
        <AccordionItem value="marine" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Marine Identification</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={navmc11811.lastName}
                  onChange={(e) => setNavmc11811Field('lastName', e.target.value)}
                  placeholder="DOE"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={navmc11811.firstName}
                  onChange={(e) => setNavmc11811Field('firstName', e.target.value)}
                  placeholder="JOHN"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName">Middle Name</Label>
                <Input
                  id="middleName"
                  value={navmc11811.middleName}
                  onChange={(e) => setNavmc11811Field('middleName', e.target.value)}
                  placeholder="ADAM"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edipi">EDIPI</Label>
                <Input
                  id="edipi"
                  value={navmc11811.edipi}
                  onChange={(e) => setNavmc11811Field('edipi', e.target.value)}
                  placeholder="1234567890"
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entryDate">Entry Date</Label>
                <Input
                  id="entryDate"
                  type="date"
                  value={navmc11811.entryDate}
                  onChange={(e) => setNavmc11811Field('entryDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="box11">Box 11</Label>
                <Input
                  id="box11"
                  value={navmc11811.box11}
                  onChange={(e) => setNavmc11811Field('box11', e.target.value)}
                  placeholder="Initials"
                  maxLength={5}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Entry Content */}
        <AccordionItem value="content" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">6105 Entry Content</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="remarksText">Administrative Remarks</Label>
              <Textarea
                id="remarksText"
                value={navmc11811.remarksText}
                onChange={(e) => setNavmc11811Field('remarksText', e.target.value)}
                placeholder={`On [DATE], you [describe the incident/deficiency].

This conduct is in violation of [cite applicable orders/regulations].

[If applicable: Previous counseling was provided on [DATE] regarding similar issues.]

You are hereby advised that [expected corrective actions].

Failure to [expected standard] may result in [potential consequences including adverse administrative or disciplinary action].

Your signature below acknowledges receipt of this counseling and does not constitute agreement with its contents.`}
                rows={16}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Include: incident description, date/location, standards violated, prior counseling (if any), 
                expected corrective actions, and consequences of continued deficiency.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Info box */}
      <div className="border rounded-md p-3 text-xs bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
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
