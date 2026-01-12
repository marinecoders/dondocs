import { useMemo } from 'react';
import { FileText, LetterText } from 'lucide-react';
import { useDocumentStore } from '@/stores/documentStore';

// Count words in text (handles empty strings gracefully)
function countWords(text: string | undefined): number {
  if (!text || !text.trim()) return 0;
  // Remove LaTeX formatting commands and count remaining words
  const cleanText = text.replace(/\\(textbf|textit|underline)\{([^}]*)\}/g, '$2');
  return cleanText.trim().split(/\s+/).length;
}

// Count characters in text
function countChars(text: string | undefined): number {
  if (!text) return 0;
  return text.length;
}

export function DocumentStats() {
  const { formData, paragraphs, references, enclosures, copyTos } = useDocumentStore();

  const stats = useMemo(() => {
    // Count paragraph words
    const paragraphWords = paragraphs.reduce((sum, para) => sum + countWords(para.text), 0);
    const paragraphChars = paragraphs.reduce((sum, para) => sum + countChars(para.text), 0);

    // Count words in key text fields (excluding letterhead/date which are boilerplate)
    const subjectWords = countWords(formData.subject);
    const fromWords = countWords(formData.from);
    const toWords = countWords(formData.to);
    const viaWords = countWords(formData.via);

    // Count reference and enclosure title words
    const referenceWords = references.reduce((sum, ref) => sum + countWords(ref.title), 0);
    const enclosureWords = enclosures.reduce((sum, encl) => sum + countWords(encl.title), 0);

    // Count copy-to words
    const copyToWords = copyTos.reduce((sum, ct) => sum + countWords(ct.text), 0);

    // Total document content words (excluding letterhead boilerplate)
    const totalWords = paragraphWords + subjectWords + fromWords + toWords + viaWords +
                       referenceWords + enclosureWords + copyToWords;

    return {
      paragraphWords,
      paragraphChars,
      totalWords,
      paragraphCount: paragraphs.length,
      referenceCount: references.length,
      enclosureCount: enclosures.length,
    };
  }, [formData, paragraphs, references, enclosures, copyTos]);

  return (
    <div className="bg-secondary/30 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        <FileText className="h-4 w-4" />
        <span>Document Statistics</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <LetterText className="h-3 w-3" />
          <span>Total words:</span>
          <span className="font-medium text-foreground">{stats.totalWords.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Body words:</span>
          <span className="font-medium text-foreground">{stats.paragraphWords.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Paragraphs:</span>
          <span className="font-medium text-foreground">{stats.paragraphCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Body chars:</span>
          <span className="font-medium text-foreground">{stats.paragraphChars.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>References:</span>
          <span className="font-medium text-foreground">{stats.referenceCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Enclosures:</span>
          <span className="font-medium text-foreground">{stats.enclosureCount}</span>
        </div>
      </div>
    </div>
  );
}
