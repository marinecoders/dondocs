import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '@/components/layout/Header';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { SidebarResizer } from '@/components/layout/SidebarResizer';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore, SIDEBAR_WIDTH } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';

beforeEach(() => {
  useUIStore.setState({ isMobile: false, sidebarCollapsed: false, sidebarWidth: 280, sidebarOutlineVisible: false, mobileDocsOpen: false, commandPaletteOpen: false });
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true });
});

it('uses one focused toggle in the compact rail and restores its width and local filter', async () => {
  const before = useDocumentStore.getState().formData;
  render(<TooltipProvider><EditorSidebar /><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Filter documents' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Search documents' }), 'Keep this filter');
  const logo = screen.getByRole('img', { name: 'Marine Coders' });
  expect(logo).toBeVisible();
  const toggle = screen.getByRole('button', { name: 'Hide sidebar' });
  const nav = screen.getByRole('navigation', { name: 'Documents' });
  await userEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Show sidebar' })).toBe(toggle);
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(nav).not.toBeVisible();
  expect(logo).not.toBeVisible();
  expect(screen.getByRole('navigation', { name: 'Document shortcuts' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'New document' })).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Search workspace' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /^(Show|Hide|Expand) sidebar$/ })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBe(toggle);
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(nav).toBeVisible();
  expect(screen.getByRole('img', { name: 'Marine Coders' })).toBe(logo);
  expect(logo).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Document shortcuts' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^(Show|Hide|Expand) sidebar$/ })).toHaveLength(1);
  expect(nav).toHaveStyle({ width: '280px' });
  expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveValue('Keep this filter');
  expect(useDocumentStore.getState().formData).toBe(before);
});

it('keeps mobile overlay opening independent of desktop collapse preference', async () => {
  useUIStore.setState({ isMobile: true, sidebarCollapsed: true });
  render(<TooltipProvider><EditorSidebar /><Header /></TooltipProvider>);
  const toggle = screen.getByRole('button', { name: 'Open workspace' });
  expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
  await userEvent.click(toggle);
  expect(useUIStore.getState().mobileDocsOpen).toBe(true);
  expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('clamps pointer and keyboard resizing without collapsing, and ends a cancelled drag', () => {
  render(<SidebarResizer />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { buttons: 1, clientX: 280 });
  act(() => document.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 20 })));
  expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.min);
  expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  act(() => document.dispatchEvent(new PointerEvent('pointercancel')));
  act(() => document.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 350 })));
  expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.min);
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.min);
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.min + 16);
});

it.each([false, true])('offers the same creation choices with sidebar collapsed=%s', async (collapsed) => {
  useUIStore.setState({ sidebarCollapsed: collapsed });
  const create = vi.spyOn(useDocumentsStore.getState(), 'newDocument').mockImplementation(() => {});
  render(<TooltipProvider><EditorSidebar /><Header /></TooltipProvider>);
  const trigger = screen.getByRole('button', { name: 'New document' });
  await userEvent.click(trigger);
  expect(create).not.toHaveBeenCalled();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    'New correspondence', 'New NAVMC 10274', 'New NAVMC 118 (11)', 'Browse forms…', 'From template…',
  ]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'New NAVMC 10274' }));
  expect(create).toHaveBeenCalledWith('navmc_10274');
  create.mockRestore();
});

it('opens workspace search from the compact rail', async () => {
  useUIStore.setState({ sidebarCollapsed: true });
  render(<TooltipProvider><EditorSidebar /><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Search workspace' }));
  expect(useUIStore.getState().commandPaletteOpen).toBe(true);
});
