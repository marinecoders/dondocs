import { useState, useMemo } from 'react';
import { Search, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';

// Common military references library
const REFERENCE_LIBRARY = [
  // Marine Corps Orders
  { category: 'Marine Corps Orders', title: 'MCO 5215.1L - Directives Management Program' },
  { category: 'Marine Corps Orders', title: 'MCO 5216.20 - Correspondence Manual' },
  { category: 'Marine Corps Orders', title: 'MCO 5210.11F - Record Management Program' },
  { category: 'Marine Corps Orders', title: 'MCO 1650.19K - Decorations and Awards' },
  { category: 'Marine Corps Orders', title: 'MCO 1900.16 - Separation and Retirement' },
  { category: 'Marine Corps Orders', title: 'MCO 1001R.1L - MCTFS User Manual' },
  { category: 'Marine Corps Orders', title: 'MCO 1020.34H - Marine Corps Uniform Regulations' },
  { category: 'Marine Corps Orders', title: 'MCO 3000.11B - Marine Air Ground Task Force Staff Training Program' },
  { category: 'Marine Corps Orders', title: 'MCO 3500.27C - Operational Risk Management' },
  { category: 'Marine Corps Orders', title: 'MCO 5580.2B - Law Enforcement Manual' },

  // SECNAV Manuals
  { category: 'SECNAV Manuals', title: 'SECNAV M-5210.1 - Department of the Navy Records Management Manual' },
  { category: 'SECNAV Manuals', title: 'SECNAV M-5216.5 - Department of the Navy Correspondence Manual' },
  { category: 'SECNAV Manuals', title: 'SECNAV M-5239.2 - DON Cybersecurity Program' },

  // SECNAV Instructions
  { category: 'SECNAV Instructions', title: 'SECNAVINST 5211.5F - Privacy Act' },
  { category: 'SECNAV Instructions', title: 'SECNAVINST 5510.30C - DON Personnel Security Program' },
  { category: 'SECNAV Instructions', title: 'SECNAVINST 5510.36B - DON Information Security Program' },

  // Marine Corps Bulletins
  { category: 'Marine Corps Bulletins', title: 'MCBul 5216 - Correspondence Procedures' },
  { category: 'Marine Corps Bulletins', title: 'MCBul 1020 - Uniform Board Decisions' },

  // Navy Regulations
  { category: 'Navy Regulations', title: 'U.S. Navy Regulations, 1990' },
  { category: 'Navy Regulations', title: 'OPNAVINST 5215.17A - Navy Directives Issuance System' },

  // Training & Readiness
  { category: 'Training & Readiness', title: 'MCRP 3-0B - How to Conduct Training' },
  { category: 'Training & Readiness', title: 'MCWP 5-10 - Marine Corps Planning Process' },

  // Common Enclosure Types
  { category: 'Common References', title: 'Reference (a)' },
  { category: 'Common References', title: 'Basic Correspondence' },
  { category: 'Common References', title: 'Endorsement 1' },
];

export function ReferenceLibraryModal() {
  const { referenceLibraryOpen, setReferenceLibraryOpen } = useUIStore();
  const { addReference } = useDocumentStore();
  const [searchQuery, setSearchQuery] = useState('');

  const groupedReferences = useMemo(() => {
    const filtered = REFERENCE_LIBRARY.filter(
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
    addReference(title);
  };

  return (
    <Dialog open={referenceLibraryOpen} onOpenChange={setReferenceLibraryOpen}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Reference Library</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search references..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

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
              No references found matching "{searchQuery}"
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
