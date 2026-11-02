// Distribution and destruction wording from the supplied TM/IETM template.
export const MANUAL_DISTRIBUTION = {
  "A": "Approved for public release.  Distribution is unlimited.",
  "B": "Distribution authorized to U.S. Government agencies only (category) (date of determination). Other requests for this document must be referred to (insert controlling DoD office).",
  "C": "Distribution authorized to U.S. Government agencies and their contractors (category) (date of determination). Other requests for this document must be referred to (insert controlling DoD office).",
  "D": "Distribution authorized to the Department of Defense and U.S DoD contractors only (category) (date of determination). Other requests must be referred to (insert controlling DoD office).",
  "E": "Distribution authorized to DoD Components only (category) (date of determination). Other requests must be referred to (insert controlling DoD office).",
  "F": "Further dissemination only as directed by (insert controlling DoD office) (date of determination) or higher DoD authority."
} as const;

export const MANUAL_DESTRUCTION = "DESTRUCTION NOTICE: Destroy by making this publication unreadable, indecipherable, and unrecoverable IAW DoDI 5200.48.";
