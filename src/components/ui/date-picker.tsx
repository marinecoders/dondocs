import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { CalendarIcon } from "lucide-react"

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

export type DateFormatType = 'military' | 'spelled'

// Try to parse various date formats and return a Date object
function parseFlexibleDate(dateString: string): Date | null {
  if (!dateString || !dateString.trim()) return null

  const trimmed = dateString.trim()

  // Common formats to try
  const formats = [
    "d MMM yy",         // 15 Dec 24 (SECNAV standard)
    "dd MMM yy",        // 15 Dec 24
    "d MMM yyyy",       // 1 Jan 2025
    "dd MMM yyyy",      // 01 Jan 2025
    "d MMMM yyyy",      // 1 January 2025
    "dd MMMM yyyy",     // 01 January 2025
    "MMMM d, yyyy",     // January 1, 2025
    "MMM d, yyyy",      // Jan 1, 2025
    "MM/dd/yyyy",       // 01/01/2025
    "M/d/yyyy",         // 1/1/2025
    "yyyy-MM-dd",       // 2025-01-01
    "d/M/yyyy",         // 1/1/2025 (day first)
    "dd/MM/yyyy",       // 01/01/2025 (day first)
  ]

  for (const fmt of formats) {
    try {
      const parsed = parse(trimmed, fmt, new Date())
      if (isValid(parsed) && parsed.getFullYear() > 1900 && parsed.getFullYear() < 2100) {
        return parsed
      }
    } catch {
      // Continue to next format
    }
  }

  // Try native Date parsing as last resort
  const nativeDate = new Date(trimmed)
  if (isValid(nativeDate) && nativeDate.getFullYear() > 1900 && nativeDate.getFullYear() < 2100) {
    return nativeDate
  }

  return null
}

// Format a Date to the specified format
function formatDate(date: Date, dateFormat: DateFormatType): string {
  return format(date, dateFormat === 'spelled' ? SPELLED_DATE_FORMAT : MILITARY_DATE_FORMAT)
}

// Get placeholder for date format
function getPlaceholder(dateFormat: DateFormatType): string {
  return dateFormat === 'spelled' ? 'January 4, 2026' : '15 Dec 24'
}

interface DatePickerProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  dateFormat?: DateFormatType
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  id,
  dateFormat = 'military',
}: DatePickerProps) {
  // Use format-appropriate placeholder if not provided
  const displayPlaceholder = placeholder || getPlaceholder(dateFormat)
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value || "")

  // Parse current value to Date for calendar
  const selectedDate = React.useMemo(() => {
    return parseFlexibleDate(value || "")
  }, [value])

  // Sync input value with prop value
  React.useEffect(() => {
    setInputValue(value || "")
  }, [value])

  // Handle input change - just update local state
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  // Handle input blur - try to parse and format
  const handleInputBlur = () => {
    if (!inputValue.trim()) {
      onChange?.("")
      return
    }

    const parsed = parseFlexibleDate(inputValue)
    if (parsed) {
      // Format to the appropriate date format
      const formatted = formatDate(parsed, dateFormat)
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
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={displayPlaceholder}
          className="pr-10"
        />
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            type="button"
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={selectedDate || undefined}
          onSelect={handleSelect}
          defaultMonth={selectedDate || new Date()}
        />
      </PopoverContent>
    </Popover>
  )
}
