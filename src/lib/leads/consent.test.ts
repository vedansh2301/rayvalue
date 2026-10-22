import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_TEXT, CONSENT_VERSION } from './consent';

/** The consent constants the database trigger sets, from the latest migration that defines them. */
function dbConstants() {
  const dir = join(process.cwd(), 'supabase/migrations');
  let text: string | null = null;
  let version: string | null = null;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const t = [...sql.matchAll(/new\.consent_text\s*:=\s*'((?:[^']|'')*)'/g)].pop();
    const v = [...sql.matchAll(/new\.consent_version\s*:=\s*'((?:[^']|'')*)'/g)].pop();
    if (t) text = t[1]!.replace(/''/g, "'");
    if (v) version = v[1]!.replace(/''/g, "'");
  }
  return { text, version };
}

describe('consent constants match the database trigger', () => {
  it('text and version equal the latest migration', () => {
    const db = dbConstants();
    expect(db.version).toBe(CONSENT_VERSION);
    expect(db.text).toBe(CONSENT_TEXT);
  });
});
