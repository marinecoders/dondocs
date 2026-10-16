import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FOOTNOTE_REFERENCE_TOKEN, referenceName } from '@/lib/publicationReferences';
import type { Paragraph } from '@/types/document';

export function PublicationTableCell({ value, label, paragraph, onChange, ensureReferenceId }: {
  value: string;
  label: string;
  paragraph: Paragraph;
  onChange: (value: string) => void;
  ensureReferenceId: () => string;
}) {
  const tokens: string[] = value.match(FOOTNOTE_REFERENCE_TOKEN) ?? [];
  const text = value.replace(FOOTNOTE_REFERENCE_TOKEN, '');
  return <div className="space-y-1">
    <Input aria-label={label} value={text} onChange={(e) => onChange(e.target.value + tokens.join(''))} />
    {tokens.map((token, index) => {
      const id = token.slice(2, -2).split('_').at(-1)!;
      const note = paragraph.tableFootnotes?.find((n) => n.id.toUpperCase() === id);
      return <Button key={`${token}-${index}`} type="button" variant="ghost" size="sm"
        aria-label={`Remove footnote ${id} from ${label}`}
        onClick={() => onChange(text + tokens.filter((_, i) => i !== index).join(''))}>
        {note ? `Footnote ${note.id}` : `Missing footnote ${id}`} ×
      </Button>;
    })}
    {!!paragraph.tableFootnotes?.length && <select aria-label={`Add footnote to ${label}`} value="" className="w-full text-xs"
      onChange={(e) => {
        if (!e.target.value) return;
        const token = `{{${referenceName('N', ensureReferenceId(), e.target.value)}}}`;
        if (!tokens.includes(token)) onChange(value + token);
      }}>
      <option value="">Add footnote</option>
      {paragraph.tableFootnotes.map((note) => <option key={note.id} value={note.id}>Footnote {note.id}</option>)}
    </select>}
  </div>;
}
