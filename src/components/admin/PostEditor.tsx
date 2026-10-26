/**
 * Social post editor island. Renders the whole <form> (native POST to the page; the server validates and re-runs the
 * checks, which are authoritative). In the browser it adds: live character / hashtag counters, live checks (the same
 * pure runChecks the server uses), template insertion, a media picker with keyboard-usable reordering, uploads and a
 * phone-frame preview. No calculator math lives here.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { checksPassed, countHashtags, runChecks, type MediaForCheck } from '../../lib/social/checks';
import { CHANNEL_LABEL, channelsLabel } from '../../lib/social/channels';
import { LIMITS } from '../../lib/social/forms';
import { CHANNELS, POST_TYPES, type Channel, type DataRef, type PostType } from '../../lib/social/types';
import MediaUploader, { type LibraryMedia } from './MediaUploader';

export interface EditorPost {
  id: string | null;
  type: PostType;
  /** Where the post goes. */
  channels: Channel[];
  title: string;
  caption: string;
  numbers_confirmed: boolean;
  share_to_feed: boolean;
  thumb_offset_ms: number | null;
  data_refs: DataRef[];
  /** 'custom' when the post already has a time, otherwise 'next_slot'. */
  when: 'next_slot' | 'custom';
  /** "YYYY-MM-DDTHH:MM" in the settings zone. */
  scheduled_local: string;
  /** social_locations key, or null for no location tag. */
  location_key: string | null;
}

export interface EditorTemplate {
  id: string;
  kind: 'caption' | 'hashtags';
  name: string;
  body: string;
}

interface Props {
  post: EditorPost;
  library: LibraryMedia[];
  /** Ordered ids of the post's media. */
  selected: string[];
  templates: EditorTemplate[];
  timezone: string;
  /** Label of the next free slot per type (null = none in range). */
  nextSlots: Record<PostType, string | null>;
  editable: boolean;
  action: string;
  /** FB_PAGE_ID and FB_PAGE_TOKEN are both set on the server (never their values). */
  facebookConnected: boolean;
  /** Channels that already published; they stay ticked and cannot be removed. */
  lockedChannels: Channel[];
  /** Location tags that can be picked (social_locations). */
  locations: { key: string; name: string }[];
}

const field = 'w-full rounded border border-stone-400 bg-white px-3 py-2 text-stone-900';
const label = 'block text-sm font-medium text-stone-800';
const btn = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const small = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-stone-400 bg-white px-2 text-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';

const maxMedia = (t: PostType) => (t === 'carousel' ? LIMITS.carouselMax : 1);
const toCheck = (m: LibraryMedia): MediaForCheck => ({ kind: m.kind, mime: m.mime, width: m.width, height: m.height, duration_s: m.duration_s });

function Thumb(p: { m: LibraryMedia; class?: string }) {
  return p.m.kind === 'image' ? (
    <img src={p.m.public_url} alt={p.m.alt_text ?? ''} loading="lazy" class={p.class} />
  ) : (
    <video src={`${p.m.public_url}#t=0.1`} muted playsInline preload="metadata" aria-label={p.m.alt_text ?? 'Video'} class={p.class} />
  );
}

function PreviewMedia(p: { m: LibraryMedia | undefined }) {
  const m = p.m;
  if (!m) return <p class="flex h-full items-center justify-center p-4 text-center text-sm text-stone-300">No media selected</p>;
  return m.kind === 'image' ? (
    <img src={m.public_url} alt={m.alt_text ?? 'Preview of the first image'} class="h-full w-full object-cover" />
  ) : (
    <video src={`${m.public_url}#t=0.1`} controls muted playsInline preload="metadata" aria-label="Preview of the first video" class="h-full w-full object-cover" />
  );
}

export default function PostEditor(p: Props) {
  const [type, setType] = useState<PostType>(p.post.type);
  const [channels, setChannels] = useState<Channel[]>(p.post.channels);
  const [previewAs, setPreviewAs] = useState<Channel>('instagram');
  const [title, setTitle] = useState(p.post.title);
  const [caption, setCaption] = useState(p.post.caption);
  const [numbersOk, setNumbersOk] = useState(p.post.numbers_confirmed);
  const [library, setLibrary] = useState<LibraryMedia[]>(p.library);
  const [selected, setSelected] = useState<string[]>(p.selected);
  const [altById, setAltById] = useState<Record<string, string>>({});
  const [when, setWhen] = useState<'next_slot' | 'custom'>(p.post.when);
  const [announce, setAnnounce] = useState('');
  const [tpl, setTpl] = useState('');
  const [tags, setTags] = useState('');
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const byId = useMemo(() => new Map(library.map((m) => [m.id, m])), [library]);
  const chosen = selected.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  const results = useMemo(
    () => runChecks({ type, caption, data_refs: p.post.data_refs, numbers_confirmed: numbersOk, media: chosen.map(toCheck), channels }),
    [type, caption, numbersOk, selected, library, channels],
  );
  const passed = checksPassed(results);
  const failing = results.filter((r) => !r.ok);
  const hashtagCount = countHashtags(caption);
  const limit = maxMedia(type);
  const captionTemplates = p.templates.filter((t) => t.kind === 'caption');
  const hashtagSets = p.templates.filter((t) => t.kind === 'hashtags');
  const nextLabel = p.nextSlots[type];
  const toggleChannel = (c: Channel, on: boolean) => setChannels((cs) => CHANNELS.filter((x) => (x === c ? on : cs.includes(x))));
  const showFb = channels.includes('facebook');
  const previewChannel: Channel = showFb && previewAs === 'facebook' ? 'facebook' : 'instagram';

  const append = (text: string) => {
    setCaption((c) => (c.trim() ? `${c.replace(/\s+$/, '')}\n\n${text}` : text));
    captionRef.current?.focus();
  };
  const add = (id: string) =>
    setSelected((s) => {
      if (s.includes(id)) return s;
      return limit === 1 ? [id] : s.length >= limit ? s : [...s, id];
    });
  const remove = (id: string) => setSelected((s) => s.filter((x) => x !== id));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSelected(next);
    setAnnounce(`Moved to position ${j + 1} of ${next.length}.`);
  };
  const onUploaded = (m: LibraryMedia) => {
    setLibrary((l) => [m, ...l.filter((x) => x.id !== m.id)]);
    add(m.id);
  };

  const first = chosen[0];
  const over = caption.length > LIMITS.caption;

  return (
    <form method="post" action={p.action} class="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <fieldset disabled={!p.editable} class="min-w-0 space-y-6 border-0 p-0">
        <legend class="sr-only">Post</legend>

        <div class="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div>
            <label for="pe-type" class={label}>Type</label>
            <select id="pe-type" name="type" class={field} value={type} onChange={(e) => setType(e.currentTarget.value as PostType)}>
              {POST_TYPES.map((t) => (
                <option key={t} value={t} selected={type === t}>{t === 'image' ? 'image (single photo)' : t}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="pe-title" class={label}>Title (for you; not posted)</label>
            <input id="pe-title" name="title" type="text" maxLength={LIMITS.title} value={title} class={field} onInput={(e) => setTitle(e.currentTarget.value)} />
          </div>
        </div>

        <fieldset class="rounded-lg border border-stone-200 bg-white p-4" aria-describedby="pe-channels-note">
          <legend class="px-1 font-semibold text-stone-900">Post to</legend>
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            {CHANNELS.map((c) => {
              const locked = p.lockedChannels.includes(c);
              return (
                <div key={c} class="flex min-h-11 items-center gap-3">
                  <input
                    id={`pe-ch-${c}`}
                    type="checkbox"
                    name={locked ? undefined : 'channels'}
                    value={c}
                    checked={channels.includes(c)}
                    disabled={locked}
                    class="h-5 w-5 shrink-0 accent-stone-900"
                    onChange={(e) => toggleChannel(c, e.currentTarget.checked)}
                  />
                  {locked && <input type="hidden" name="channels" value={c} />}
                  <label for={`pe-ch-${c}`} class="text-stone-900">
                    {CHANNEL_LABEL[c]}
                    {locked && <span class="text-sm text-stone-700"> (already published)</span>}
                  </label>
                </div>
              );
            })}
          </div>
          <p id="pe-channels-note" class="mt-1 text-sm text-stone-700">Stories post to Instagram only. A post is “Published” once every ticked channel has published.</p>
          {channels.length === 0 && <p role="alert" class="mt-2 text-sm font-medium text-red-800">Pick at least one channel.</p>}
          {showFb && !p.facebookConnected && (
            <p role="status" class="mt-2 rounded border border-amber-400 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
              The Facebook Page is not connected yet, so this post will wait in review until it is. Connection steps are in docs/LAUNCH.md.
            </p>
          )}
        </fieldset>

        <div>
          <label for="pe-location" class={label}>Location tag</label>
          <select id="pe-location" name="location_key" class={`${field} max-w-sm`} aria-describedby="pe-location-note">
            <option value="" selected={!p.post.location_key}>None</option>
            {p.locations.map((l) => (
              <option key={l.key} value={l.key} selected={p.post.location_key === l.key}>{l.name}</option>
            ))}
          </select>
          <p id="pe-location-note" class="mt-1 text-sm text-stone-700">Tags the Instagram and Facebook post with this place (not Stories). If a channel refuses it, the post goes out without it.</p>
        </div>

        <div>
          <label for="pe-caption" class={label}>Caption</label>
          <textarea id="pe-caption" name="caption" ref={captionRef} rows={10} value={caption} aria-describedby="pe-counts" class={`${field} ${over ? 'border-red-700' : ''}`} onInput={(e) => setCaption(e.currentTarget.value)}></textarea>
          <p id="pe-counts" class="mt-1 text-sm text-stone-800">
            <span class={over ? 'font-semibold text-red-800' : ''}>{caption.length}/{LIMITS.caption} characters</span>
            {' · '}
            <span class={hashtagCount > 30 ? 'font-semibold text-red-800' : ''}>{hashtagCount}/30 hashtags</span>
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label for="pe-tpl" class={label}>Caption template</label>
              <div class="flex gap-2">
                <select id="pe-tpl" class={field} value={tpl} onChange={(e) => setTpl(e.currentTarget.value)}>
                  <option value="">{captionTemplates.length ? 'Choose…' : 'No templates yet'}</option>
                  {captionTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button type="button" class={`${btn} border border-stone-400 bg-white text-stone-900 hover:bg-stone-100`} disabled={!tpl} onClick={() => append(captionTemplates.find((t) => t.id === tpl)?.body ?? '')}>Insert</button>
              </div>
            </div>
            <div>
              <label for="pe-tags" class={label}>Hashtag set</label>
              <div class="flex gap-2">
                <select id="pe-tags" class={field} value={tags} onChange={(e) => setTags(e.currentTarget.value)}>
                  <option value="">{hashtagSets.length ? 'Choose…' : 'No sets yet'}</option>
                  {hashtagSets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button type="button" class={`${btn} border border-stone-400 bg-white text-stone-900 hover:bg-stone-100`} disabled={!tags} onClick={() => append(hashtagSets.find((t) => t.id === tags)?.body ?? '')}>Insert</button>
              </div>
            </div>
          </div>
        </div>

        <fieldset class="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <legend class="px-1 font-semibold text-stone-900">Media ({chosen.length}/{limit})</legend>
          <p class="text-sm text-stone-700">
            {type === 'carousel' ? 'A carousel needs 2 to 10 photos or videos. Use the arrows to reorder.' : type === 'reel' ? 'A Reel needs one video, ideally 9:16 (1080×1920).' : type === 'image' ? 'A photo post needs one JPEG, between 4:5 and 1.91:1.' : 'A Story takes one photo or video.'}
          </p>
          {chosen.length === 0 && <p class="text-sm font-medium text-stone-900">Nothing selected yet. Pick from the library or upload below.</p>}
          <ol class="space-y-2">
            {chosen.map((m, i) => (
              <li key={m.id} class="flex flex-wrap items-start gap-3 rounded border border-stone-200 p-2">
                <input type="hidden" name="media_ids" value={m.id} />
                <Thumb m={m} class="h-20 w-14 shrink-0 rounded bg-stone-200 object-cover" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-stone-900">{i + 1}. {m.kind}{m.duration_s ? `, ${m.duration_s}s` : ''}{m.width && m.height ? `, ${m.width}×${m.height}` : ''}</p>
                  <label for={`alt-${m.id}`} class="text-xs font-medium text-stone-800">Alt text</label>
                  <input id={`alt-${m.id}`} name={`alt_${m.id}`} type="text" maxLength={LIMITS.alt} class={field} value={altById[m.id] ?? m.alt_text ?? ''} onInput={(e) => setAltById((a) => ({ ...a, [m.id]: e.currentTarget.value }))} />
                </div>
                <div class="flex gap-1">
                  <button type="button" class={small} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move item ${i + 1} up`}>↑</button>
                  <button type="button" class={small} disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label={`Move item ${i + 1} down`}>↓</button>
                  <button type="button" class={small} onClick={() => remove(m.id)} aria-label={`Remove item ${i + 1}`}>✕</button>
                </div>
              </li>
            ))}
          </ol>
          <p class="sr-only" role="status" aria-live="polite">{announce}</p>

          <details class="rounded border border-stone-200 p-2" open={chosen.length === 0}>
            <summary class="min-h-11 cursor-pointer py-2 font-medium text-stone-900">Choose from the library ({library.length})</summary>
            {library.length === 0 && <p class="text-sm text-stone-700">The library is empty. Upload a file below.</p>}
            <ul class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {library.map((m) => {
                const inUse = selected.includes(m.id);
                const full = limit > 1 && selected.length >= limit && !inUse;
                return (
                  <li key={m.id} class="rounded border border-stone-200 p-1">
                    <Thumb m={m} class="aspect-[9/16] w-full rounded bg-stone-200 object-cover" />
                    <p class="mt-1 truncate text-xs text-stone-700">{m.kind}{m.duration_s ? `, ${m.duration_s}s` : ''}</p>
                    <button type="button" class={`${small} mt-1 w-full`} disabled={inUse || full} onClick={() => add(m.id)}>
                      {inUse ? 'Selected' : limit === 1 && selected.length ? 'Use instead' : 'Add'}
                      <span class="sr-only"> {m.kind} {m.alt_text ?? ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>

          <MediaUploader onUploaded={onUploaded} idPrefix="pe-up" />
        </fieldset>

        {type === 'reel' && (
          <fieldset class="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
            <legend class="px-1 font-semibold text-stone-900">Reel options</legend>
            <div>
              <label for="pe-thumb" class={label}>Cover frame offset (milliseconds from the start)</label>
              <input id="pe-thumb" name="thumb_offset_ms" type="number" min={0} step={1} inputMode="numeric" value={p.post.thumb_offset_ms ?? ''} class={`${field} max-w-48`} />
              <p class="text-xs text-stone-700">Leave empty to let Instagram pick the cover.</p>
            </div>
            <div class="flex gap-3">
              <input id="pe-feed" type="checkbox" name="share_to_feed" checked={p.post.share_to_feed} class="mt-1 h-5 w-5 shrink-0 accent-stone-900" />
              <label for="pe-feed" class="text-stone-900">Also show on the profile grid (share to feed)</label>
            </div>
          </fieldset>
        )}

        <div class="flex gap-3 rounded-lg border border-stone-200 bg-white p-4">
          <input id="pe-nums" type="checkbox" name="numbers_confirmed" checked={numbersOk} class="mt-1 h-5 w-5 shrink-0 accent-stone-900" onChange={(e) => setNumbersOk(e.currentTarget.checked)} />
          <label for="pe-nums" class="text-stone-900">
            I checked every number in this caption
            <span class="block text-sm text-stone-700">Needed when the caption has figures that are not traced to the database (uploaded posts). Never tick it for a number you have not verified.</span>
          </label>
        </div>

        <section aria-labelledby="pe-checks-h" class="rounded-lg border border-stone-200 bg-white p-4">
          <h2 id="pe-checks-h" class="font-semibold text-stone-900">Checks</h2>
          <div aria-live="polite" aria-atomic="true">
            <p class={`mt-1 text-sm font-semibold ${passed ? 'text-green-800' : 'text-red-800'}`}>{passed ? 'All required checks pass.' : `${results.filter((r) => !r.ok && r.level === 'error').length} required check(s) failing. The post cannot publish yet.`}</p>
            <ul class="mt-2 space-y-1 text-sm">
              {failing.map((r) => (
                <li key={r.key} class={r.level === 'error' ? 'text-red-800' : 'text-amber-900'}>
                  <strong>{r.level === 'error' ? 'Error:' : 'Warning:'}</strong> {r.message}
                </li>
              ))}
              {failing.length === 0 && <li class="text-stone-700">Nothing to fix.</li>}
            </ul>
          </div>
        </section>

        {p.editable && (
          <fieldset class="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
            <legend class="px-1 font-semibold text-stone-900">Schedule</legend>
            <div class="flex gap-3">
              <input id="pe-when-slot" type="radio" name="when" value="next_slot" checked={when === 'next_slot'} class="mt-1 h-5 w-5 shrink-0 accent-stone-900" onChange={() => setWhen('next_slot')} />
              <label for="pe-when-slot" class="text-stone-900">
                Next free slot
                <span class="block text-sm text-stone-700">{nextLabel ? `${type}: ${nextLabel}` : `No free ${type} slot in the next three weeks (edit slots in Settings).`}</span>
              </label>
            </div>
            <div class="flex gap-3">
              <input id="pe-when-custom" type="radio" name="when" value="custom" checked={when === 'custom'} class="mt-1 h-5 w-5 shrink-0 accent-stone-900" onChange={() => setWhen('custom')} />
              <div class="min-w-0">
                <label for="pe-when-custom" class="text-stone-900">Pick a date and time</label>
                <div class="mt-1">
                  <label for="pe-local" class="sr-only">Date and time in {p.timezone}</label>
                  <input id="pe-local" name="scheduled_local" type="datetime-local" value={p.post.scheduled_local} class={`${field} max-w-64`} onFocus={() => setWhen('custom')} />
                  <span class="block text-xs text-stone-700">Time zone: {p.timezone}</span>
                </div>
              </div>
            </div>
            {!passed && <p class="text-sm font-medium text-amber-900">A required check is failing, so scheduling will put this post in “Needs review” instead.</p>}
            <div class="flex flex-wrap gap-2 pt-1">
              <button type="submit" name="action" value="save" class={`${btn} bg-stone-900 text-white hover:bg-stone-700`}>Save changes</button>
              <button type="submit" name="action" value="schedule" class={`${btn} bg-sun-400 text-stone-900 hover:bg-sun-500`}>Schedule</button>
              <button type="submit" name="action" value="publish_now" class={`${btn} border border-stone-900 bg-white text-stone-900 hover:bg-stone-100`}>Publish now</button>
            </div>
            <p class="text-sm text-stone-700">“Publish now” queues the post for immediate publishing. The publisher runs about every 15 minutes, so it goes out within roughly 15 minutes.</p>
          </fieldset>
        )}
      </fieldset>

      <aside aria-label="Preview" class="lg:sticky lg:top-4 lg:self-start">
        <p class="mb-2 text-sm font-semibold text-stone-900">Preview ({channelsLabel(channels.length ? channels : ['instagram'])})</p>
        {showFb && (
          <div class="mb-3 flex gap-1" role="group" aria-label="Preview style">
            {CHANNELS.filter((c) => channels.includes(c)).map((c) => (
              <button key={c} type="button" aria-pressed={previewChannel === c} class={`min-h-11 rounded border px-3 text-sm ${previewChannel === c ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-900'}`} onClick={() => setPreviewAs(c)}>
                {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>
        )}
        {previewChannel === 'instagram' ? (
          <div class="mx-auto w-64 overflow-hidden rounded-[2rem] border-8 border-stone-900 bg-black shadow">
            <div class="aspect-[9/16] w-full bg-stone-800">
              <PreviewMedia m={first} />
            </div>
            <div class="max-h-48 overflow-y-auto bg-white p-3 text-xs leading-5 text-stone-900">
              <p class="whitespace-pre-wrap break-words">{caption || <span class="text-stone-600">Caption appears here.</span>}</p>
            </div>
          </div>
        ) : (
          <div class="mx-auto w-full max-w-xs overflow-hidden rounded-lg border border-stone-300 bg-white shadow">
            <p class="border-b border-stone-200 px-3 py-2 text-xs font-semibold text-stone-900">Your Facebook Page</p>
            <div class="max-h-40 overflow-y-auto px-3 py-2 text-sm leading-5 text-stone-900">
              <p class="whitespace-pre-wrap break-words">{caption || <span class="text-stone-600">Caption appears here.</span>}</p>
            </div>
            <div class="aspect-[4/5] w-full bg-stone-800">
              <PreviewMedia m={first} />
            </div>
          </div>
        )}
        {chosen.length > 1 && <p class="mt-2 text-center text-xs text-stone-700">Showing item 1 of {chosen.length}.</p>}
        {previewChannel === 'facebook' && <p class="mt-2 text-center text-xs text-stone-700">Approximate. Facebook decides the final layout.</p>}
      </aside>
    </form>
  );
}
