// Radix defers close focus. A control selected outside that closing scope
// takes precedence over restoring the original launcher.
export function preserveOutsideFocus(event: Event): boolean {
  const active = document.activeElement
  const closingScope = event.currentTarget
  if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement &&
    active.isConnected && !active.hasAttribute('data-radix-focus-guard') &&
    closingScope instanceof HTMLElement && !closingScope.contains(active)) {
    event.preventDefault()
    return true
  }
  return false
}
