import { describe, expect, it } from 'vitest';
import { containerParams, createInstagramClient, IgError, INSIGHT_METRICS, scrub } from './instagram';

const TOKEN = 'IGAAtoken0123456789abcdefghijklmnopqrstuvwxyz';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  form: Record<string, string>;
}

/** Fake fetch: records calls, answers from `respond`. */
function fake(respond: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      form: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))),
    };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

const base = { caption: 'Hello', share_to_feed: true, thumb_offset_ms: null };
const vid = { kind: 'video' as const, public_url: 'https://x.supabase.co/v.mp4' };
const img = { kind: 'image' as const, public_url: 'https://x.supabase.co/i.jpg' };

describe('containerParams', () => {
  it('reel: REELS + video_url + caption + share_to_feed (+ thumb_offset when set)', () => {
    expect(containerParams({ ...base, type: 'reel' }, [vid])).toEqual([{ media_type: 'REELS', video_url: vid.public_url, caption: 'Hello', share_to_feed: 'true' }]);
    expect(containerParams({ ...base, type: 'reel', share_to_feed: false, thumb_offset_ms: 1500 }, [vid])[0]).toMatchObject({ share_to_feed: 'false', thumb_offset: '1500' });
  });
  it('image: image_url + caption, no media_type', () => {
    expect(containerParams({ ...base, type: 'image' }, [img])).toEqual([{ image_url: img.public_url, caption: 'Hello' }]);
  });
  it('story: STORIES with image_url or video_url and no caption', () => {
    expect(containerParams({ ...base, type: 'story' }, [img])).toEqual([{ media_type: 'STORIES', image_url: img.public_url }]);
    expect(containerParams({ ...base, type: 'story' }, [vid])).toEqual([{ media_type: 'STORIES', video_url: vid.public_url }]);
  });
  it('carousel: one is_carousel_item child per media, videos with media_type=VIDEO, no caption on children', () => {
    expect(containerParams({ ...base, type: 'carousel' }, [img, vid])).toEqual([
      { is_carousel_item: 'true', image_url: img.public_url },
      { is_carousel_item: 'true', media_type: 'VIDEO', video_url: vid.public_url },
    ]);
  });
  it('rejects the wrong media kind', () => {
    expect(() => containerParams({ ...base, type: 'reel' }, [img])).toThrow(IgError);
    expect(() => containerParams({ ...base, type: 'image' }, [vid])).toThrow(IgError);
  });
});

describe('client', () => {
  const mk = (respond: Parameters<typeof fake>[0]) => {
    const t = fake(respond);
    return { ...t, ig: createInstagramClient({ token: TOKEN, userId: '178', fetch: t.f, sleep: async () => {} }) };
  };

  it('creates a reel container: POST v26.0/{user}/media with the token in the header, not the URL or body', async () => {
    const { ig, calls } = mk(() => ({ json: { id: 'C1' } }));
    expect(await ig.createContainer({ ...base, type: 'reel' }, [vid])).toBe('C1');
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url.origin + c.url.pathname).toBe('https://graph.instagram.com/v26.0/178/media');
    expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.url.search).toBe('');
    expect(JSON.stringify(c.form)).not.toContain(TOKEN);
    expect(c.form.media_type).toBe('REELS');
  });

  it('creates carousel children first, then the parent with comma-separated children and the caption', async () => {
    let n = 0;
    const { ig, calls } = mk((c) => (c.method === 'GET' ? { json: { status_code: 'FINISHED' } } : { json: { id: `ID${++n}` } }));
    expect(await ig.createContainer({ ...base, type: 'carousel' }, [img, vid, img])).toBe('ID4');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.form.is_carousel_item ?? p.form.media_type)).toEqual(['true', 'true', 'true', 'CAROUSEL']);
    expect(posts[3]!.form).toEqual({ media_type: 'CAROUSEL', children: 'ID1,ID2,ID3', caption: 'Hello' });
    // only the video child is polled
    expect(calls.filter((c) => c.method === 'GET').map((c) => c.url.pathname)).toEqual(['/v26.0/ID2']);
  });

  it('waits for a processing carousel video child, and gives up with a retryable error', async () => {
    let polls = 0;
    const slow = mk((c) => (c.method === 'GET' ? { json: { status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' } } : { json: { id: 'X' } }));
    await expect(slow.ig.createContainer({ ...base, type: 'carousel' }, [vid, img])).resolves.toBe('X');
    const stuck = mk((c) => (c.method === 'GET' ? { json: { status_code: 'IN_PROGRESS' } } : { json: { id: 'X' } }));
    await expect(stuck.ig.createContainer({ ...base, type: 'carousel' }, [vid, img])).rejects.toThrow(/still processing/);
  });

  it('reads container status and publishes', async () => {
    const { ig, calls } = mk((c) => (c.url.pathname.endsWith('media_publish') ? { json: { id: 'M1' } } : { json: { status_code: 'ERROR', status: 'Error: 2207026 bad video' } }));
    expect(await ig.getContainerStatus('C1')).toEqual({ status: 'ERROR', detail: 'Error: 2207026 bad video' });
    expect(calls[0]!.url.searchParams.get('fields')).toBe('status_code,status');
    expect(await ig.publishContainer('C1')).toBe('M1');
    expect(calls[1]!.url.pathname).toBe('/v26.0/178/media_publish');
    expect(calls[1]!.form).toEqual({ creation_id: 'C1' });
  });

  it('reads the permalink', async () => {
    const { ig, calls } = mk(() => ({ json: { permalink: 'https://www.instagram.com/reel/abc/', id: 'M1' } }));
    expect(await ig.getPermalink('M1')).toBe('https://www.instagram.com/reel/abc/');
    expect(calls[0]!.url.searchParams.get('fields')).toBe('permalink');
  });

  it('refreshes the token via the unversioned endpoint with the token as a query parameter', async () => {
    const { ig, calls } = mk(() => ({ json: { access_token: 'IGnewtoken0123456789abcdefghijkl', token_type: 'bearer', expires_in: 5184000 } }));
    expect(await ig.refreshToken()).toEqual({ accessToken: 'IGnewtoken0123456789abcdefghijkl', expiresInSeconds: 5184000 });
    expect(calls[0]!.url.pathname).toBe('/refresh_access_token');
    expect(calls[0]!.url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(calls[0]!.url.searchParams.get('access_token')).toBe(TOKEN);
  });

  it('flattens insights per type', async () => {
    const { ig, calls } = mk(() => ({ json: { data: [{ name: 'views', values: [{ value: 120 }] }, { name: 'reach', values: [{ value: 80 }] }] } }));
    expect(await ig.getInsights('M1', 'reel')).toEqual({ views: 120, reach: 80 });
    expect(calls[0]!.url.searchParams.get('metric')).toBe(INSIGHT_METRICS.reel.join(','));
    expect(INSIGHT_METRICS.reel).not.toContain('impressions');
    expect(INSIGHT_METRICS.reel).not.toContain('plays');
  });

  it('falls back to one metric at a time when a metric is rejected', async () => {
    const { ig } = mk((c) => {
      const m = c.url.searchParams.get('metric')!;
      if (m.includes(',') || m === 'saved') return { status: 400, json: { error: { message: 'metric invalid', code: 100 } } };
      return { json: { data: [{ name: m, values: [{ value: 1 }] }] } };
    });
    const out = await ig.getInsights('M1', 'image');
    expect(Object.keys(out)).toEqual(['views', 'reach', 'likes', 'comments', 'shares', 'total_interactions']);
  });

  it('read-only mode refuses POSTs without calling fetch', async () => {
    const t = fake(() => ({ json: { id: 'C1' } }));
    const ig = createInstagramClient({ token: TOKEN, userId: '178', fetch: t.f, readOnly: true });
    await expect(ig.createContainer({ ...base, type: 'image' }, [img])).rejects.toThrow(/Dry run/);
    await expect(ig.publishContainer('C1')).rejects.toThrow(/Dry run/);
    expect(t.calls).toHaveLength(0);
  });
});

describe('errors never contain the token', () => {
  it('maps API errors to a short message and scrubs the token', async () => {
    const t = fake(() => ({ status: 400, json: { error: { message: `Invalid OAuth access token ${TOKEN} (access_token=${TOKEN})`, code: 190, error_subcode: 460 } } }));
    const ig = createInstagramClient({ token: TOKEN, userId: '178', fetch: t.f });
    const e = (await ig.getPermalink('M1').catch((x) => x)) as IgError;
    expect(e).toBeInstanceOf(IgError);
    expect(e.code).toBe(190);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toMatch(/IGAA/);
    expect(e.message.length).toBeLessThanOrEqual(300);
    expect(e.transient).toBe(false);
  });
  it('network failures are transient and carry no URL', async () => {
    const boom = (async () => {
      throw new TypeError(`fetch failed https://graph.instagram.com/refresh_access_token?access_token=${TOKEN}`);
    }) as typeof fetch;
    const ig = createInstagramClient({ token: TOKEN, userId: '178', fetch: boom });
    const e = (await ig.refreshToken().catch((x) => x)) as IgError;
    expect(e.transient).toBe(true);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain('http');
  });
  it('scrub removes the token and token-looking strings', () => {
    expect(scrub(`a ${TOKEN} b`, TOKEN)).toBe('a [token] b');
    expect(scrub('x access_token=abc123&y=1')).toBe('x access_token=[token]&y=1');
  });
});
