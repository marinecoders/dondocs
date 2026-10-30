/**
 * Whether this browser had never opened DonDocs before this page load.
 *
 * Every visit leaves something in localStorage (the persisted stores write as
 * the app starts), so an empty store means a first visit. It has to be read
 * before those stores load, which is why main.tsx imports this module first;
 * read later, this load's own writes would hide the answer. Blocked storage
 * can't tell, so it counts as a return visit.
 */
function readFirstVisit(): boolean {
  try {
    return localStorage.length === 0;
  } catch {
    return false;
  }
}

const firstVisit = readFirstVisit();

export function isFirstVisit(): boolean {
  return firstVisit;
}
