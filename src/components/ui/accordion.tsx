import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Inside AccordionStaticProvider, the Accordion renders as plain always-open
// sections (no collapse, no chevron). Used by the editor, where a navigation rail
// handles wayfinding. Outside a provider it stays collapsible as normal.
const AccordionStaticContext = React.createContext(false)

export function AccordionStaticProvider({ children }: { children: React.ReactNode }) {
  return <AccordionStaticContext.Provider value={true}>{children}</AccordionStaticContext.Provider>
}

const dataAttrs = (props: object) =>
  Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("data-")))

function Accordion(props: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  const isStatic = React.useContext(AccordionStaticContext)
  if (isStatic) {
    return (
      <div data-slot="accordion" className={props.className} {...dataAttrs(props)}>
        {props.children}
      </div>
    )
  }
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
  className,
  children,
  id,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  const isStatic = React.useContext(AccordionStaticContext)
  const cls = cn("border border-border rounded-lg bg-card/60 backdrop-blur-sm px-3 shadow-sm", className)
  if (isStatic) {
    // Editor sections are one flat surface separated by hairlines, not bordered
    // cards, so the box styling (cls) is dropped — but a caller-supplied
    // className is still merged (e.g. the forms' active-section left-rule).
    // Forward id + data-* so the navigation rail can anchor to each.
    return (
      <div data-slot="accordion-item" id={id} className={cn("border-t border-border pt-6 pb-6", className)} {...dataAttrs(props)}>
        {children}
      </div>
    )
  }
  return (
    <AccordionPrimitive.Item data-slot="accordion-item" id={id} className={cls} {...props}>
      {children}
    </AccordionPrimitive.Item>
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  const isStatic = React.useContext(AccordionStaticContext)
  if (isStatic) {
    // A plain, non-interactive section header: no button, no chevron. role=heading
    // keeps the editor's section structure navigable by screen readers.
    return (
      <div className="flex">
        <div
          data-slot="accordion-trigger"
          role="heading"
          aria-level={3}
          className={cn("flex flex-1 items-start justify-between gap-4 pb-3 text-left text-base font-semibold", className)}
          {...dataAttrs(props)}
        >
          {children}
        </div>
      </div>
    )
  }
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-[color,box-shadow] outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  const isStatic = React.useContext(AccordionStaticContext)
  if (isStatic) {
    return (
      <div data-slot="accordion-content" className="text-sm" {...dataAttrs(props)}>
        <div className={cn("pt-0 pb-0", className)}>{children}</div>
      </div>
    )
  }
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
