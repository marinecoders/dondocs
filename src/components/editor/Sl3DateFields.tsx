import { format, isValid, parseISO } from 'date-fns';
import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { lastWorkingDay, validatePublicationDate } from '@/lib/publicationDate';
import { useDocumentStore } from '@/stores/documentStore';

const validISO = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));

export function Sl3DateFields() {
  const [closuresOpen, setClosuresOpen] = useState(false);
  const { date = '', publicationSigningDate = '', publicationClosedDates = '' } = useDocumentStore((s) => s.formData);
  const setField = useDocumentStore((s) => s.setField);
  const closures = publicationClosedDates.split(/[\s,;]+/).filter(Boolean);
  const selectedClosures = closures.filter(validISO).map((value) => parseISO(value));
  const signed = validISO(publicationSigningDate) ? parseISO(publicationSigningDate) : null;
  const expected = signed && closures.every(validISO) ? lastWorkingDay(signed, closures) : null;
  const suggested = expected && expected.getMonth() === signed?.getMonth() ? format(expected, 'd MMM yy') : null;
  const warnings = validatePublicationDate(date, publicationSigningDate, publicationClosedDates);

  return (
    <div className="space-y-4">
      <div className="sl3-field-grid">
        <div className="min-w-0 space-y-2">
          <Label className="text-sm" htmlFor="sl3-publication-date">Publication date</Label>
          <DatePicker id="sl3-publication-date" value={date}
            onChange={(value) => setField('date', value)}
            calendarLabel="Choose publication date" className="sl3-date-control"
            aria-describedby="sl3-date-guidance" />
        </div>
        <div className="min-w-0 space-y-2">
          <Label className="text-sm" htmlFor="sl3-signing-date">Signing date</Label>
          <DatePicker id="sl3-signing-date" value={publicationSigningDate}
            onChange={(value) => setField('publicationSigningDate', value)}
            dateFormat="iso" calendarLabel="Choose signing date" className="sl3-date-control"
            aria-describedby="sl3-date-guidance" />
        </div>
      </div>
      <p id="sl3-date-guidance" className="text-xs leading-relaxed text-muted-foreground">
        Choose a date or type one. The publication date must be the last working day
        of the signing month, allowing for federal holidays and office closures.
      </p>
      {suggested && date !== suggested && (
        <Button variant="outline" size="sm" onClick={() => setField('date', suggested)}>
          Use {suggested} for publication
        </Button>
      )}
      <div className="space-y-2">
        <Label className="text-sm" htmlFor="sl3-closure-dates">Office closure dates</Label>
        <Popover open={closuresOpen} onOpenChange={setClosuresOpen}>
          <div className="sl3-date-control relative">
            <Input id="sl3-closure-dates" value={publicationClosedDates}
              onChange={(e) => setField('publicationClosedDates', e.target.value)}
              placeholder="YYYY-MM-DD, YYYY-MM-DD" className="pr-11"
              aria-describedby="sl3-closure-guidance" />
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" type="button"
                aria-label="Choose office closure dates"
                className="absolute right-0 top-0 h-full px-3">
                <CalendarIcon className="size-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
          </div>
          {closuresOpen && <PopoverContent className="w-auto p-0" align="end">
            <div className="border-b px-4 py-3 text-sm">
              <p className="font-medium">Office closures</p>
              <p className="text-xs text-muted-foreground">Select dates. Select again to remove.</p>
            </div>
            <Calendar autoFocus mode="multiple" selected={selectedClosures}
              defaultMonth={signed ?? selectedClosures[0] ?? new Date()}
              onSelect={(dates) => setField('publicationClosedDates', [
                ...(dates ?? []).map((d) => format(d, 'yyyy-MM-dd')).sort(),
                // Retain invalid typed entries so calendar edits cannot hide errors.
                ...closures.filter((value) => !validISO(value)),
              ].join(', '))} />
          </PopoverContent>}
        </Popover>
        <p id="sl3-closure-guidance" className="text-xs leading-relaxed text-muted-foreground">
          Optional. Pick multiple dates in the calendar, or enter dates separated by commas.
        </p>
      </div>
      {warnings.length > 0 && (
        <div role="status" aria-label="Publication date checks" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          {warnings.map(({ message }) => <p key={message}>{message}</p>)}
        </div>
      )}
    </div>
  );
}
