# Regression corpus

Every entry here is a permanent test for a bug that shipped to users
(or could have, if a build had been cut at the wrong moment).

Naming conventions:

- **`issue-NNN-short-slug.test.ts`** — bug reported as a user-facing
  GitHub issue; NNN is the issue number, so a stale `git log` query
  for the issue lands on the canary that prevents it returning.
- **`pr-NNN-short-slug.test.ts`** — bug caught **internally** by the
  test harness (e.g. the LaTeX compile matrix surfacing an undefined
  macro that SwiftLaTeX silently swallowed in production but xelatex
  rejected). NNN is the PR that introduced both the harness coverage
  and the fix. Same purpose as `issue-`: the canary prevents the
  specific bug from sneaking back in even if the harness is later
  refactored.

## Adding a new entry

Whenever a user-reported bug gets fixed:

1. Reduce the bug to the smallest input that reproduces it.
2. Add a new file here named after the issue number.
3. The test should fail on the pre-fix code and pass on the post-fix
   code. (You can verify this by checking out the pre-fix commit and
   watching it fail.)
4. The file's docstring should link back to the issue / PR and briefly
   describe the failure mode in plain English so future maintainers
   understand what the test is protecting against.

These tests are deliberately separate from the property and unit
suites: they're tiny, hand-authored, and accumulate forever. The
property tests prevent the **class** of bug; the corpus prevents the
**specific** bug from sneaking back in even if the property is later
weakened.
