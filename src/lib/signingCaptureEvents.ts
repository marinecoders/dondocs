const listeners = new Set<(id: string) => void>();
export function subscribeSigningCapture(listener: (id: string) => void): () => void {
  listeners.add(listener);return () => { listeners.delete(listener); };
}
export function publishSigningCapture(id: string): void {
  for (const listener of listeners) notifyObserver(listener, id);
}
import { notifyObserver } from './observers';

