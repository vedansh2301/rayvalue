import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from './robots';

const txt = `
User-agent: *
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/public/
Crawl-delay: 5

User-agent: RayValueBot
Disallow: /blocked
`;
describe('robots.txt', () => {
  it('prefers the group naming our bot over *', () => {
    const r = parseRobots(txt);
    expect(isAllowed(r, '/blocked/page')).toBe(false);
    expect(isAllowed(r, '/private/x')).toBe(true); // the * group does not apply to us
    expect(r.crawlDelay).toBeNull();
  });
  it('falls back to * with longest-match allow and $ anchors', () => {
    const r = parseRobots(txt, 'otherbot');
    expect(isAllowed(r, '/private/secret')).toBe(false);
    expect(isAllowed(r, '/private/public/a')).toBe(true);
    expect(isAllowed(r, '/docs/file.pdf')).toBe(false);
    expect(isAllowed(r, '/docs/file.pdf?x=1')).toBe(true);
    expect(isAllowed(r, '/open')).toBe(true);
    expect(r.crawlDelay).toBe(5);
  });
  it('empty Disallow allows everything; empty file allows everything; Disallow / blocks', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), '/a')).toBe(true);
    expect(isAllowed(parseRobots(''), '/a')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /'), '/a')).toBe(false);
  });
  it('ignores comments and merges stacked user-agent lines', () => {
    const r = parseRobots('User-agent: a\nUser-agent: rayvaluebot # us\nDisallow: /x # no\n');
    expect(isAllowed(r, '/x')).toBe(false);
  });
});
