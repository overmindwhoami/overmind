/**
 * The last check on everything the Overmind says or writes (terminal replies, disk notes, launch notes, posts), after
 * the model and before anyone sees it or it goes on a disk or on chain. It catches what the instructions alone can't
 * guarantee:
 *   PRIVATE_TERMS   words that must never appear (the people behind it, their handles, emails, personal wallets),
 *                   comma-separated; set on the server through stdin, never written in the code
 *   always          email addresses, phone numbers, IP addresses, and anything shaped like a key or token
 * A reply that trips it is replaced; a note falls back to the written voice; a post isn't sent.
 */
const TERMS = (process.env.PRIVATE_TERMS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
const PATTERNS: RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, // an email address
  /\+\d[\d\s-]{7,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, // a phone number (+ international, or 3-3-4); years, ranges and counts don't match
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/, // an IP address
  /\b(sk-ant-[\w-]{10,}|AKIA[0-9A-Z]{16}|api[-_]?key=|bearer\s+[\w.-]{20,}|-----BEGIN)/i, // keys and tokens
];
/** Whether a text is safe to show, write or post. */
export function privateHit(text: string): string | undefined {
  const t = text.toLowerCase();
  const term = TERMS.find((x) => t.includes(x));
  if (term) return 'a private term';
  const p = PATTERNS.find((re) => re.test(text));
  return p ? `a pattern (${p.source.slice(0, 24)}…)` : undefined;
}
/** Logs a block without echoing what was blocked. */
export const blocked = (where: string, why: string) => console.warn(`privacy: held back a ${where} (${why})`);
export const privacyTerms = () => TERMS.length;
