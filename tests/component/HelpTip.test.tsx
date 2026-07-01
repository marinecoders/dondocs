/**
 * Component tests for <HelpTip>.
 *
 * The editor's "?" help affordances used to be a bare <HelpCircle> SVG handed
 * straight to a Radix TooltipTrigger. An SVG isn't focusable and has no
 * accessible name, so the guidance was mouse-hover-only. HelpTip wraps it in a
 * real, labelled <button> so keyboard + screen-reader users can reach it.
 *
 * These lock in (1) the button + accessible name + decorative icon, and (2) that
 * inside the editor's *static* accordion headers (FormPanel wraps every section
 * in <AccordionStaticProvider>, where the header renders as a role=heading div,
 * not a <button>) the help button is NOT nested inside another button.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelpTip } from '@/components/ui/help-tip';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionStaticProvider,
} from '@/components/ui/accordion';

describe('HelpTip — accessible help affordance', () => {
  it('renders a focusable button with a default accessible name', () => {
    render(<HelpTip>Some guidance</HelpTip>);
    const btn = screen.getByRole('button', { name: 'More information' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('accepts a custom label and marks the icon decorative', () => {
    render(<HelpTip label="About letterhead">x</HelpTip>);
    const btn = screen.getByRole('button', { name: 'About letterhead' });
    // The lucide icon must be hidden from assistive tech (the button carries the name).
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does NOT nest a button inside the editor’s static accordion header', () => {
    const { container } = render(
      <AccordionStaticProvider>
        <Accordion>
          <AccordionItem value="letterhead">
            <AccordionTrigger>
              Letterhead <HelpTip>Unit name, address, seal.</HelpTip>
            </AccordionTrigger>
          </AccordionItem>
        </Accordion>
      </AccordionStaticProvider>
    );
    // Static header is a role=heading div, not a button…
    expect(container.querySelector('[role="heading"]')).toBeTruthy();
    // …so the help button is the only button, never button-in-button.
    expect(container.querySelectorAll('button button').length).toBe(0);
    expect(screen.getByRole('button', { name: 'More information' }).tagName).toBe('BUTTON');
  });
});
