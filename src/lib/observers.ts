/** Observers report state; their errors or pending promises never own the operation. */
export function notifyObserver<T>(observer: ((value: T) => unknown) | undefined, value: T): void {
  try { void Promise.resolve(observer?.(value)).catch(() => {}); } catch { /* Reporting is advisory. */ }
}
