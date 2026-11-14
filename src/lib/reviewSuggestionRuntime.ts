import type { DocumentScope } from '@/stores/documentsStore';
import type { ReviewRound } from './reviewRounds';
import type { ReviewSuggestionState } from './reviewSuggestions';

export interface ReviewSuggestionContext { scope: DocumentScope; round: ReviewRound; state: ReviewSuggestionState | null }
const contexts = new Map<string, ReviewSuggestionContext>();
let generation = 0;
const listeners = new Set<() => void>();
const key = (documentId: string, roundId: string) => JSON.stringify([documentId, roundId]);

/** Only active-document actions install this metadata; durable writes remain in DocumentWrites. */
export function cacheReviewSuggestions(scope: DocumentScope, round: ReviewRound, state: ReviewSuggestionState | null): void {
  contexts.set(key(scope.documentId, round.id), { scope, round: structuredClone(round), state: state && structuredClone(state) });
  generation++;for (const listener of listeners) listener();
}
export function cachedReviewSuggestions(scope: DocumentScope, roundId: string): ReviewSuggestionContext | null {
  const value = contexts.get(key(scope.documentId, roundId));
  return value && value.scope.epoch === scope.epoch ? { scope: value.scope, round: structuredClone(value.round), state: value.state && structuredClone(value.state) } : null;
}
export function rebindReviewSuggestionHistory(before: DocumentScope | null, after: DocumentScope | null): void {
  if (!before || !after || before.documentId !== after.documentId) return;
  for (const value of contexts.values()) if (value.scope.documentId === before.documentId && value.scope.epoch === before.epoch) value.scope = after;
}
export function forgetReviewSuggestions(roundId: string): void {
  for (const [id, value] of contexts) if (value.round.id === roundId) contexts.delete(id);
  generation++;for (const listener of listeners) listener();
}
export const subscribeReviewSuggestions = (listener: () => void) => { listeners.add(listener);return () => { listeners.delete(listener); }; };
export const reviewSuggestionGeneration = () => generation;
