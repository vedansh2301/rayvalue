/**
 * Data-driven post templates the generator (scripts/social/, run by .github/workflows/social-render.yml) can render.
 * The /admin/social "Generate" menu lists these; `target` says what the template is generated for.
 */
import type { PostType } from './types';

export interface TemplateKey {
  key: string;
  label: string;
  type: PostType;
  /** What `target` means for this template: a utility slug, a state code, or nothing. */
  target: 'utility' | 'state' | 'none';
}

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  { key: 'utility-payback-reel', label: 'Payback by utility (Reel)', type: 'reel', target: 'utility' },
  { key: 'utility-payback-carousel', label: 'Payback by utility (carousel)', type: 'carousel', target: 'utility' },
  { key: 'credit-gone-reel', label: 'Solar without the federal credit (Reel)', type: 'reel', target: 'state' },
  { key: 'battery-worth-it-reel', label: 'Is a battery worth adding? (Reel)', type: 'reel', target: 'utility' },
  { key: 'bill-size-reel', label: 'Payback by monthly bill (Reel)', type: 'reel', target: 'utility' },
  { key: 'fl-vs-ca-reel', label: 'Florida vs California (Reel)', type: 'reel', target: 'none' },
];

export const templateByKey = (key: string) => TEMPLATE_KEYS.find((t) => t.key === key) ?? null;
