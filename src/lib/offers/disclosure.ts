/** Disclosure wording keyed by offers.disclosure_key. An unknown key falls back to the standard text (never to nothing). */
export const DEFAULT_DISCLOSURE_KEY = 'affiliate_standard';

export const DISCLOSURES: Record<string, string> = {
  [DEFAULT_DISCLOSURE_KEY]: 'Some links below are affiliate links. If you click one and buy, RayValue may earn a commission at no extra cost to you.',
};

export const disclosureText = (key: string | null | undefined): string => DISCLOSURES[key ?? ''] ?? (DISCLOSURES[DEFAULT_DISCLOSURE_KEY] as string);
