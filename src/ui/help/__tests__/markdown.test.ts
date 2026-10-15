// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown blockquotes', () => {
  it('keeps a single-paragraph quote as one inline run', () => {
    const el = renderMarkdown('> one\n> two');
    const bq = el.querySelector('blockquote')!;
    expect(bq.querySelectorAll('p').length).toBe(0);
    expect(bq.textContent).toBe('one two');
  });

  it('treats a bare ">" as a paragraph break inside the same quote', () => {
    const el = renderMarkdown('> first\n>\n> second');
    const quotes = el.querySelectorAll('blockquote');
    expect(quotes.length).toBe(1);
    const ps = quotes[0].querySelectorAll('p');
    expect([...ps].map((p) => p.textContent)).toEqual(['first', 'second']);
    expect(el.textContent).not.toContain('>');
  });
});
