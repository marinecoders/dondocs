import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { normalizeDate, type DateFormatType } from "@/lib/dateFormatting"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// SECNAV M-5216.5 date format: "15 Dec 24" (abbreviated month, 2-digit year)
// Per Ch 7, Para 3.a.(3) - Date is in abbreviated format
const MILITARY_DATE_FORMAT = "d MMM yy"

// Business letter date format: "January 4, 2026" (spelled out month, 4-digit year)
// Per SECNAV M-5216.5 Ch 11 - Business letters use spelled format
const SPELLED_DATE_FORMAT = "MMMM d, yyyy"

export type { DateFormatType } from "@/lib/dateFormatting"

function parseCalendarDate(value: string, style: DateFormatType): Date | null {
  // Keep an explicit four-digit year in the calendar even for a military field.
  // ISO metadata fields retain their existing short military-year shortcut.
  // Spelled correspondence dates require an explicit four-digit year.
  const normalized = normalizeDate(value, 'iso') ?? normalizeDate(value, style === 'iso' ? 'military' : style)
  if (normalized === null) return null
  const pattern = /^\d{4}-/.test(normalized) ? 'yyyy-MM-dd'
    : style === 'spelled' ? SPELLED_DATE_FORMAT : MILITARY_DATE_FORMAT
  const parsed = parse(normalized, pattern, new Date())
  return isValid(parsed) ? parsed : null
}

// Format a Date to the specified format
function formatDate(date: Date, dateFormat: DateFormatType): string {
  return format(date, dateFormat === 'iso' ? 'yyyy-MM-dd' : dateFormat === 'spelled' ? SPELLED_DATE_FORMAT : MILITARY_DATE_FORMAT)
}

// Get placeholder for date format
function getPlaceholder(dateFormat: DateFormatType): string {
  return dateFormat === 'iso' ? 'YYYY-MM-DD' : dateFormat === 'spelled' ? 'January 4, 2026' : '15 Dec 24'
}

interface DatePickerProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  dateFormat?: DateFormatType
  calendarLabel?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  id,
  dateFormat = 'military',
  calendarLabel = 'Open calendar',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: DatePickerProps) {
  // Use format-appropriate placeholder if not provided
  const displayPlaceholder = placeholder || getPlaceholder(dateFormat)
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value || "")

  // Parse current value to Date for calendar
  const selectedDate = React.useMemo(() => {
    return parseCalendarDate(value || "", dateFormat)
  }, [value, dateFormat])

  // Sync input value with prop value.
  // Controlled-input-with-local-buffer pattern. Local `inputValue` lets the
  // user type partial dates ("5/" while typing "5/12/26") without immediately
  // normalizing them; we re-sync to the prop whenever
  // the canonical `value` changes externally (calendar click, programmatic).
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(value || "")
  }, [value])

  // Handle input change - just update local state
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  // Handle input blur - try to parse and format
  const handleInputBlur = () => {
    // Focusing an imported value must not silently apply its displayed fix,
    // invalidate an Apply click, or create a second history edit on blur.
    if (inputValue === (value || "")) return
    if (!inputValue.trim()) {
      setInputValue("")
      onChange?.("")
      return
    }

    const parsed = dateFormat === 'iso' ? parseCalendarDate(inputValue, dateFormat) : null
    const formatted = normalizeDate(inputValue, dateFormat) ?? (parsed ? formatDate(parsed, dateFormat) : null)
    if (formatted !== null) {
      // Format to the appropriate date format
      setInputValue(formatted)
      onChange?.(formatted)
    } else {
      // Keep the original value if can't parse
      onChange?.(inputValue)
    }
  }

  // Handle calendar selection
  const handleSelect = (date: Date | undefined) => {
    if (date) {
      const formatted = formatDate(date, dateFormat)
      setInputValue(formatted)
      onChange?.(formatted)
    }
    setOpen(false)
  }

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputBlur()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={displayPlaceholder}
          className="pr-10"
        />
        <PopoverTrigger asChild>
          <Button
            aria-label={calendarLabel}
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            type="button"
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
      </div>
      {/* Closing calendars must not retain hit targets during an exit animation. */}
      {open && <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          autoFocus
          mode="single"
          selected={selectedDate || undefined}
          onSelect={handleSelect}
          defaultMonth={selectedDate || new Date()}
        />
      </PopoverContent>}
    </Popover>
  )
}
