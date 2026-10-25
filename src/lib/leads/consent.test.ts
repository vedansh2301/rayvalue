import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_TEMPLATE,
  CONSENT_VERSION_AREA,
  CONSENT_VERSION_NAMED,
  NO_INSTALLERS_PHRASE,
  SUBMIT_LABEL,
  consentFor,
  joinInstallerNames,
  splitAtPrivacyPolicy,
} from './consent';

/** The constants the database trigger declares, from the latest migration that defines leads_set_consent. */
function dbConstants() {
  const dir = join(process.cwd(), 'supabase/migrations');
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    if (!sql.includes('function public.leads_set_consent')) continue;
    for (const m of sql.matchAll(/(v_[a-z_]+)\s+constant text := '((?:[^']|'')*)';/g)) out[m[1]!] = m[2]!.replace(/''/g, "'");
  }
  return out;
}

describe('consent constants match the database trigger', () => {
  it('template, versions and generic phrase equal the latest migration', () => {
    const db = dbConstants();
    expect(db.v_template).toBe(CONSENT_TEMPLATE);
    expect(db.v_version_named).toBe(CONSENT_VERSION_NAMED);
    expect(db.v_version_area).toBe(CONSENT_VERSION_AREA);
    expect(db.v_area_phrase).toBe(NO_INSTALLERS_PHRASE);
  });
  it('the migration joins names like joinInstallerNames', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0006_lead_capture.sql'), 'utf8');
    expect(sql).toContain("new.consented_installers[1] || ' and ' || new.consented_installers[2]");
    expect(sql).toContain("array_to_string(new.consented_installers[1:n - 1], ', ') || ', and ' || new.consented_installers[n]");
  });
});

describe('consentFor', () => {
  it('names the installers in the template', () => {
    const c = consentFor(['Acme Solar LLC', 'Bright Roofs Inc']);
    expect(c.version).toBe(CONSENT_VERSION_NAMED);
    expect(c.text).toContain('RayValue and Acme Solar LLC and Bright Roofs Inc may contact me');
    expect(c.text).not.toContain('{{');
    expect(c.installers).toEqual(['Acme Solar LLC', 'Bright Roofs Inc']);
  });
  it('falls back to the generic phrase when no installer serves the ZIP', () => {
    const c = consentFor([]);
    expect(c.version).toBe(CONSENT_VERSION_AREA);
    expect(c.text).toContain(`RayValue and ${NO_INSTALLERS_PHRASE} may contact me`);
    expect(c.installers).toEqual([]);
  });
  it('refers to the real button label and is not a condition of purchase', () => {
    expect(consentFor(['A']).text).toContain(`"${SUBMIT_LABEL},"`);
    expect(consentFor(['A']).text).toContain('Consent is not a condition of purchase');
    expect(consentFor(['A']).text).toContain('Reply STOP to opt out');
  });
});

describe('helpers', () => {
  it('joins names with an Oxford comma from three up', () => {
    expect(joinInstallerNames(['A'])).toBe('A');
    expect(joinInstallerNames(['A', 'B', 'C'])).toBe('A, B, and C');
  });
  it('splits around the Privacy Policy phrase', () => {
    expect(splitAtPrivacyPolicy('See our Privacy Policy.')).toEqual(['See our ', '.']);
    expect(splitAtPrivacyPolicy('nothing')).toBeNull();
  });
});
