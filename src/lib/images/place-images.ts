/**
 * Astro-only lookup over the place photo library: src/data/images/credits.json joined with the optimised files under
 * src/assets/places. Segments are URL segments (GB is "uk"); `getArticleImage` accepts the ISO2 `country` of an article
 * ("gb" is mapped to "uk").
 */
import type { ImageMetadata } from 'astro';
import credits from '../../data/images/credits.json';
import { pickPhoto, type PhotoCredit, type PhotoKey } from './library';

export interface Photo extends PhotoCredit { src: ImageMetadata }

const files = import.meta.glob<{ default: ImageMetadata }>('../../assets/places/**/*.jpg', { eager: true });
const bySuffix = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(files)) bySuffix.set(path.replace('../../assets/places/', ''), mod.default);

export const allPhotos: Photo[] = (credits as PhotoCredit[]).flatMap((c) => {
  const src = bySuffix.get(c.file);
  return src ? [{ ...c, src }] : [];
});

const seg = (country: string): string => (country.toLowerCase() === 'gb' ? 'uk' : country.toLowerCase());
const pick = (key: PhotoKey, seed?: string): Photo | null => pickPhoto(allPhotos, key, seed);

/** The country photo (cc is a URL segment or ISO2 code); null only when the country has none. */
export const getCountryImage = (cc: string): Photo | null => pick({ country: seg(cc) });

/** All country-level photos in priority order (primary first): UK is Tower Bridge then Westminster, AU the Opera House then Uluru. */
export const getCountryImages = (cc: string): Photo[] => allPhotos.filter((p) => p.country === seg(cc) && p.scope === 'country');

/** The photo for a city or US state ("florida" | "california"), falling back to the country photo. */
export const getPlaceImage = (cc: string, slug?: string): Photo | null => pick({ country: seg(cc), place: slug });

export interface ArticleImage { src: ImageMetadata; alt: string; /** The library photo when no cover is set (carries the credit data). */ photo: Photo | null }
interface ArticleLike { id: string; data: { country?: string; state?: 'FL' | 'CA' | 'both'; cover?: ImageMetadata; coverAlt?: string } }

/** An article's own `cover` if set, else the best library photo: its US state, else its country. */
export function getArticleImage(entry: ArticleLike): ArticleImage | null {
  const { cover, coverAlt, country = 'us', state } = entry.data;
  if (cover) return { src: cover, alt: coverAlt ?? '', photo: null };
  const place = seg(country) === 'us' && state && state !== 'both' ? (state === 'FL' ? 'florida' : 'california') : undefined;
  const photo = pick({ country: seg(country), place }, entry.id);
  return photo ? { src: photo.src, alt: photo.alt, photo } : null;
}
