/**
 * `<...>` inline tokens in block text (recurrence rules, task times). This
 * module only finds the brackets; each token kind brings its own content
 * parser, and angle brackets around anything no parser accepts stay prose.
 */

const TOKEN_RE = /<([^<>\n]+)>/g;

export interface AngleToken<T> {
  /** span of the whole token, brackets included */
  from: number;
  to: number;
  value: T;
}

/** Every `<...>` token whose content the parser accepts, in text order. */
export function findAngleTokens<T>(
  text: string,
  parse: (content: string) => T | null,
): AngleToken<T>[] {
  const tokens: AngleToken<T>[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const value = parse(match[1]!);
    if (value !== null)
      tokens.push({
        from: match.index,
        to: match.index + match[0].length,
        value,
      });
  }
  return tokens;
}

/** First `<...>` token whose content the parser accepts. */
export function findAngleToken<T>(
  text: string,
  parse: (content: string) => T | null,
): AngleToken<T> | null {
  return findAngleTokens(text, parse)[0] ?? null;
}

/**
 * Remove the span [from, to) together with one adjacent space, so
 * "a <x> b" becomes "a b" and a trailing token leaves no trailing space.
 */
export function cutToken(text: string, from: number, to: number): string {
  if (text[to] === ' ' && (from === 0 || text[from - 1] === ' ')) to += 1;
  else if (text[from - 1] === ' ') from -= 1;
  return text.slice(0, from) + text.slice(to);
}
