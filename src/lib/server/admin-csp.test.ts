import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminCspDirectives, applyAdminCsp, supabaseOrigin } from './admin-csp';

describe('admin CSP', () => {
  it('extracts the https origin only', () => {
    expect(supabaseOrigin('https://abc.supabase.co/rest/v1')).toBe('https://abc.supabase.co');
    expect(supabaseOrigin('http://abc.supabase.co')).toBeNull();
    expect(supabaseOrigin('nonsense')).toBeNull();
    expect(supabaseOrigin(undefined)).toBeNull();
  });
  it('allows the Supabase origin for upload, images and video, nothing wider', () => {
    const d = adminCspDirectives('https://abc.supabase.co');
    expect(d).toEqual(["connect-src 'self' https://abc.supabase.co", "img-src 'self' data: blob: https://abc.supabase.co", "media-src 'self' blob: https://abc.supabase.co"]);
    expect(d.join(' ')).not.toMatch(/\*|unsafe/);
  });
  it('adds no remote origin when SUPABASE_URL is missing', () => {
    expect(adminCspDirectives(undefined).join(' ')).not.toContain('https://');
  });
  it('inserts every directive into the page policy', () => {
    const got: string[] = [];
    applyAdminCsp({ insertDirective: (x) => got.push(x) }, 'https://abc.supabase.co');
    expect(got).toHaveLength(3);
  });
});

describe('vercel.json headers', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  const csp = (source: string) => cfg.headers.find((h) => h.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  it('the public policy excludes /admin and stays free of Supabase origins', () => {
    const pub = cfg.headers.find((h) => h.source.startsWith('/((?!admin'));
    expect(pub).toBeTruthy();
    expect(csp(pub!.source)).toBe("connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  });
  it('/admin has its own policy naming the Supabase origin for connect, img and media', () => {
    const p = csp('/admin/:path*');
    expect(p).toMatch(/connect-src 'self' https:\/\/[a-z0-9]+\.supabase\.co;/);
    expect(p).toMatch(/img-src [^;]*https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(p).toMatch(/media-src [^;]*https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).not.toContain('unsafe');
  });
});
