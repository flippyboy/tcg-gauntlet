// The plain data shapes that pages and components share. No server code is imported
// here, so client components can use them.

export interface CardRow {
  count: number;
  name: string;
  set: string | null;
  number: string | null;
  /** Scryfall's `small` and `normal` image URLs for the page, or null. */
  small: string | null;
  normal: string | null;
  known: boolean;
}

export interface GroupView {
  name: string;
  count: number;
  cards: CardRow[];
}

export interface ViolationView {
  code: string;
  severity: string;
  line: number | null;
  message: string;
  suggestion: string | null;
}
