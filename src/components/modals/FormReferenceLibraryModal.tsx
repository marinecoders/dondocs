import { useState, useMemo } from 'react';
import { Search, Plus, Library } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

// Common military references library for forms/counseling
const FORM_REFERENCE_LIBRARY = [
  // Personnel/Admin Orders
  { category: 'Personnel Administration', title: 'MCO 1610.7A - Performance Evaluation System' },
  { category: 'Personnel Administration', title: 'MCO 1900.16 - Separation and Retirement Manual' },
  { category: 'Personnel Administration', title: 'MCO 1070.12K - Individual Records Administration Manual' },
  { category: 'Personnel Administration', title: 'MCO P1080.20 - Marine Corps Promotions Manual' },
  { category: 'Personnel Administration', title: 'MCO 1001R.1L - MCTFS User Manual' },

  // Physical Fitness
  { category: 'Physical Fitness', title: 'MCO 6100.13A W/CH 1 - Marine Corps Physical Fitness and Combat Fitness Tests' },
  { category: 'Physical Fitness', title: 'MCO 6110.3A - Marine Corps Body Composition and Military Appearance Program' },

  // Conduct/Discipline
  { category: 'Conduct & Discipline', title: 'MCO 5800.16A - Marine Corps Manual for Legal Administration (LEGADMINMAN)' },
  { category: 'Conduct & Discipline', title: 'MCO 1752.5C - Sexual Assault Prevention and Response Program' },
  { category: 'Conduct & Discipline', title: 'MCO 5354.1F - Marine Corps Prohibited Activities and Conduct Prevention' },
  { category: 'Conduct & Discipline', title: 'JAGMAN - Manual of the Judge Advocate General' },

  // Uniforms/Standards
  { category: 'Standards', title: 'MCO 1020.34H - Marine Corps Uniform Regulations' },
  { category: 'Standards', title: 'MCO P1100.72C - Military Occupational Specialties Manual' },

  // Substance Abuse
  { category: 'Substance Abuse', title: 'MCO 5300.17A - Marine Corps Substance Abuse Program' },
  { category: 'Substance Abuse', title: 'MCO 5300.6 - Urinalysis Program' },

  // Leave/Liberty
  { category: 'Leave & Liberty', title: 'MCO 1050.3J - Regulations for Leave, Liberty, and Administrative Absence' },

  // Training
  { category: 'Training', title: 'MCO 1510.118 - Individual Training Standards' },
  { category: 'Training', title: 'MCO 3500.27C - Operational Risk Management' },

  // Safety
  { category: 'Safety', title: 'MCO 5100.29C - Marine Corps Safety Program' },
  { category: 'Safety', title: 'MCO 5100.19F - Marine Corps Traffic Safety Program' },

  // UCMJ Articles (commonly referenced)
  { category: 'UCMJ', title: 'UCMJ Article 86 - Absence Without Leave' },
  { category: 'UCMJ', title: 'UCMJ Article 91 - Insubordinate Conduct' },
  { category: 'UCMJ', title: 'UCMJ Article 92 - Failure to Obey Order or Regulation' },
  { category: 'UCMJ', title: 'UCMJ Article 107 - False Official Statements' },
  { category: 'UCMJ', title: 'UCMJ Article 112a - Wrongful Use of Controlled Substances' },
  { category: 'UCMJ', title: 'UCMJ Article 128 - Assault' },
  { category: 'UCMJ', title: 'UCMJ Article 134 - General Article' },

  // Financial
  { category: 'Financial', title: 'MCO 7220.52F - Marine Corps Indebtedness Processing Procedures' },
];

interface FormReferenceLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (reference: string) => void;
}

export function FormReferenceLibraryModal({ open, onOpenChange, onSelect }: FormReferenceLibraryModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const groupedReferences = useMemo(() => {
    const filtered = FORM_REFERENCE_LIBRARY.filter(
      (ref) =>
        ref.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ref.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const grouped: Record<string, string[]> = {};
    for (const ref of filtered) {
      if (!grouped[ref.category]) {
        grouped[ref.category] = [];
      }
      grouped[ref.category].push(ref.title);
    }
    return grouped;
  }, [searchQuery]);

  const handleAddReference = (title: string) => {
    onSelect(title);
  };

  const totalResults = Object.values(groupedReferences).reduce((acc, refs) => acc + refs.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            Reference Library
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search references..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <p className="text-sm text-muted-foreground">
          {searchQuery ? `${totalResults} results found` : 'Browse or search common references for counseling and administrative actions'}
        </p>

        <ScrollArea className="h-[400px] pr-4">
          {Object.entries(groupedReferences).map(([category, refs]) => (
            <div key={category} className="mb-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                {category}
              </h4>
              <div className="space-y-1">
                {refs.map((title) => (
                  <div
                    key={title}
                    className="flex items-center justify-between p-2 rounded-md hover:bg-secondary/50 group"
                  >
                    <span className="text-sm">{title}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAddReference(title)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(groupedReferences).length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <Library className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No references found matching "{searchQuery}"</p>
              <p className="text-sm mt-1">Try a different search term</p>
            </div>
          )}
        </ScrollArea>

        <div className="text-xs text-muted-foreground border-t pt-3">
          Click "Add" to append a reference to your form. References will be automatically lettered.
        </div>
      </DialogContent>
    </Dialog>
  );
}
