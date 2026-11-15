import { parseReviewRound, reviewRoundStatus, type ReviewRound } from './reviewRounds';

export type ReviewRoundTransition = 'close' | 'reopen' | 'supersede';

/** Advance received state only along its retained append-only history. */
export function mergeReceivedReviewLifecycle(existing: ReviewRound, incoming: ReviewRound): ReviewRound {
  const retained = parseReviewRound(existing);
  const received = parseReviewRound(incoming);
  if (retained.ownerDocumentId) return retained;
  if (retained.id !== received.id || retained.baselineDigest !== received.baselineDigest
    || retained.sourceDocumentId !== received.sourceDocumentId) {
    throw new Error('The received review belongs to a different baseline.');
  }
  const previousEvents = retained.lifecycle?.events ?? [];
  const incomingEvents = received.lifecycle?.events ?? [];
  const sharedLength = Math.min(previousEvents.length, incomingEvents.length);
  if (JSON.stringify(previousEvents.slice(0, sharedLength)) !== JSON.stringify(incomingEvents.slice(0, sharedLength))) {
    throw new Error('The received review state conflicts with its retained history.');
  }
  if (incomingEvents.length <= previousEvents.length) return retained;
  return parseReviewRound({ ...retained, lifecycle: received.lifecycle });
}

/** Lifecycle metadata changes without rewriting the captured baseline or decisions. */
export function planReviewRoundTransition(round: ReviewRound, transition: ReviewRoundTransition,
  replacement?: ReviewRound, changedAt = Date.now(), eventId = crypto.randomUUID()): ReviewRound {
  const before = parseReviewRound(round);
  const status = reviewRoundStatus(before);
  if ((before.lifecycle?.events.length ?? 0) >= 100) {
    throw new Error('This round has reached its state-history limit. Start a new review round.');
  }
  if (transition === 'reopen' ? status !== 'closed' : status !== 'active') {
    throw new Error('The round state changed. Refresh the review workspace before trying again.');
  }
  if (transition === 'supersede' && (!replacement || replacement.id === before.id
    || !before.ownerDocumentId || replacement.ownerDocumentId !== before.ownerDocumentId
    || reviewRoundStatus(replacement) !== 'active' || replacement.createdAt <= before.createdAt)) {
    throw new Error('Choose a newer active review belonging to the same source draft.');
  }
  return parseReviewRound({
    ...before,
    lifecycle: { events: [...before.lifecycle?.events ?? [], {
      id: eventId,
      state: transition === 'close' ? 'closed' : transition === 'reopen' ? 'active' : 'superseded',
      changedAt: Math.max(changedAt, before.lifecycle?.events.at(-1)?.changedAt ?? before.createdAt),
      ...(transition === 'supersede' ? { replacementRoundId: replacement!.id } : {}),
    }] },
  });
}
