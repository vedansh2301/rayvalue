import { describe, expect, it } from 'vitest';
import { absolutePermalink, createFacebookClient, FB_INSIGHT_METRICS, FbError, facebookUnsupported } from './facebook';

const TOKEN = 'EAAfbpagetoken0123456789abcdefghijklmnopqrstuvwxyz';

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

const mk = (respond: Parameters<typeof fake>[0], extra: { readOnly?: boolean } = {}) => {
  const t = fake(respond);
  return { ...t, fb: createFacebookClient({ token: TOKEN, pageId: 'PAGE', fetch: t.f, ...extra }) };
};

describe('photo posts', () => {
  it('POST /{page}/photos with url + caption (and the deprecated message alias), token in the header only', async () => {
    const { fb, calls } = mk(() => ({ json: { id: '111', post_id: 'PAGE_111' } }));
    expect(await fb.publishPhoto('https://x/i.jpg', 'Hi')).toEqual({ postId: 'PAGE_111', photoId: '111' });
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url.origin + c.url.pathname).toBe('https://graph.facebook.com/v26.0/PAGE/photos');
    expect(c.url.search).toBe('');
    expect(c.headers.Authorization).toBe(`OAuth ${TOKEN}`);
    expect(c.form).toEqual({ url: 'https://x/i.jpg', caption: 'Hi', message: 'Hi', published: 'true' });
    expect(JSON.stringify(c.form)).not.toContain(TOKEN);
  });

  it('falls back to the photo id when no post_id comes back, and errors when neither does', async () => {
    expect((await mk(() => ({ json: { id: '111' } })).fb.publishPhoto('u', 'c')).postId).toBe('111');
    await expect(mk(() => ({ json: {} })).fb.publishPhoto('u', 'c')).rejects.toThrow(/no post id/);
  });

  it('multi-photo: unpublished uploads first, then one feed post with attached_media[i]', async () => {
    let n = 0;
    const { fb, calls } = mk((c) => (c.url.pathname.endsWith('/feed') ? { json: { id: 'PAGE_FEED' } } : { json: { id: `P${++n}` } }));
    expect(await fb.publishMultiPhoto(['u1', 'u2'], 'Cap')).toEqual({ postId: 'PAGE_FEED' });
    expect(calls.map((c) => c.url.pathname)).toEqual(['/v26.0/PAGE/photos', '/v26.0/PAGE/photos', '/v26.0/PAGE/feed']);
    expect(calls[0]!.form).toEqual({ url: 'u1', published: 'false' });
    expect(calls[2]!.form).toEqual({ message: 'Cap', 'attached_media[0]': '{"media_fbid":"P1"}', 'attached_media[1]': '{"media_fbid":"P2"}' });
  });

  it('multi-photo needs two photos', async () => {
    await expect(mk(() => ({ json: {} })).fb.publishMultiPhoto(['u1'], 'c')).rejects.toThrow(/at least two/);
  });
});

describe('reels', () => {
  it('start / hosted upload (file_url header on rupload) / status / finish', async () => {
    const { fb, calls } = mk((c) => {
      if (c.url.host === 'rupload.facebook.com') return { json: { success: true } };
      if (c.method === 'GET') return { json: { status: { video_status: 'processing', publishing_phase: { publish_status: 'draft' } } } };
      return { json: c.form.upload_phase === 'start' ? { video_id: 'V1', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/V1' } : { success: true } };
    });
    expect(await fb.startReel()).toBe('V1');
    await fb.uploadReelFromUrl('V1', 'https://x/v.mp4');
    expect(await fb.getReelStatus('V1')).toEqual({ videoStatus: 'processing', publishStatus: 'draft', error: null });
    await fb.finishReel('V1', 'Cap #solar');

    expect(calls[0]!.url.pathname).toBe('/v26.0/PAGE/video_reels');
    expect(calls[0]!.form).toEqual({ upload_phase: 'start' });
    expect(calls[1]!.url.origin + calls[1]!.url.pathname).toBe('https://rupload.facebook.com/video-upload/v26.0/V1');
    expect(calls[1]!.headers).toMatchObject({ file_url: 'https://x/v.mp4', Authorization: `OAuth ${TOKEN}` });
    expect(calls[2]!.url.searchParams.get('fields')).toBe('status');
    expect(calls[3]!.form).toEqual({ video_id: 'V1', upload_phase: 'finish', video_state: 'PUBLISHED', description: 'Cap #solar' });
  });

  it('status surfaces a short processing error and rejects unknown statuses', async () => {
    const bad = mk(() => ({ json: { status: { video_status: 'error', processing_phase: { status: 'error', error: { message: `bad codec ${TOKEN}` } } } } }));
    const s = await bad.fb.getReelStatus('V1');
    expect(s.videoStatus).toBe('error');
    expect(s.error).toContain('bad codec');
    expect(s.error).not.toContain(TOKEN);
    await expect(mk(() => ({ json: { status: { video_status: 'wat' } } })).fb.getReelStatus('V1')).rejects.toThrow(/unknown Reel status/);
  });

  it('an upload or finish that does not report success is an error', async () => {
    await expect(mk(() => ({ json: { success: false } })).fb.uploadReelFromUrl('V1', 'u')).rejects.toThrow(/did not accept/);
    await expect(mk(() => ({ json: {} })).fb.finishReel('V1', 'd')).rejects.toThrow(/did not confirm/);
    await expect(mk(() => ({ json: {} })).fb.startReel()).rejects.toThrow(/no video id/);
  });
});

describe('permalink', () => {
  it('reads permalink_url and makes relative paths absolute', async () => {
    const abs = mk(() => ({ json: { permalink_url: 'https://www.facebook.com/PAGE/posts/1' } }));
    expect(await abs.fb.getPermalink('PAGE_1')).toBe('https://www.facebook.com/PAGE/posts/1');
    expect(abs.calls[0]!.url.searchParams.get('fields')).toBe('permalink_url');
    expect(await mk(() => ({ json: { permalink_url: '/reel/55/' } })).fb.getPermalink('55')).toBe('https://www.facebook.com/reel/55/');
    expect(await mk(() => ({ json: {} })).fb.getPermalink('55')).toBeNull();
    expect(absolutePermalink('javascript:alert(1)')).toBeNull();
    expect(absolutePermalink('http://evil.example/x')).toBeNull();
  });
});

describe('insights', () => {
  it('photo posts use /{id}/insights with current metrics; reactions by type are summed', async () => {
    const { fb, calls } = mk(() => ({ json: { data: [{ name: 'post_media_view', values: [{ value: 90 }] }, { name: 'post_reactions_by_type_total', values: [{ value: { like: 3, love: 1 } }] }] } }));
    expect(await fb.getInsights('PAGE_1', 'image')).toEqual({ post_media_view: 90, post_reactions_total: 4 });
    expect(calls[0]!.url.pathname).toBe('/v26.0/PAGE_1/insights');
    expect(calls[0]!.url.searchParams.get('metric')).toBe(FB_INSIGHT_METRICS.image.join(','));
    expect(calls[0]!.url.searchParams.get('period')).toBe('lifetime');
    // deprecated metrics are never requested
    for (const type of ['image', 'carousel', 'reel'] as const) {
      expect(FB_INSIGHT_METRICS[type]).not.toContain('post_impressions');
      expect(FB_INSIGHT_METRICS[type]).not.toContain('post_impressions_unique');
    }
  });

  it('reels use /{video}/video_insights; stories have none', async () => {
    const { fb, calls } = mk(() => ({ json: { data: [{ name: 'blue_reels_play_count', values: [{ value: 12 }] }] } }));
    expect(await fb.getInsights('V1', 'reel')).toEqual({ blue_reels_play_count: 12 });
    expect(calls[0]!.url.pathname).toBe('/v26.0/V1/video_insights');
    expect(await fb.getInsights('x', 'story')).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('falls back to one metric at a time when a metric is rejected', async () => {
    const { fb } = mk((c) => {
      const m = c.url.searchParams.get('metric')!;
      if (m.includes(',') || m === 'post_clicks') return { status: 400, json: { error: { message: 'invalid metric', code: 100 } } };
      return { json: { data: [{ name: m, values: [{ value: 1 }] }] } };
    });
    expect(Object.keys(await fb.getInsights('P', 'image'))).toEqual(['post_media_view', 'post_total_media_view_unique', 'post_reactions_by_type_total']);
  });
});

describe('dry run and errors', () => {
  it('read-only mode refuses every POST without calling fetch, but allows GETs', async () => {
    const { fb, calls } = mk(() => ({ json: { permalink_url: 'https://www.facebook.com/x' } }), { readOnly: true });
    await expect(fb.publishPhoto('u', 'c')).rejects.toThrow(/Dry run/);
    await expect(fb.publishMultiPhoto(['a', 'b'], 'c')).rejects.toThrow(/Dry run/);
    await expect(fb.startReel()).rejects.toThrow(/Dry run/);
    await expect(fb.uploadReelFromUrl('V', 'u')).rejects.toThrow(/Dry run/);
    await expect(fb.finishReel('V', 'd')).rejects.toThrow(/Dry run/);
    expect(calls).toHaveLength(0);
    await fb.getPermalink('1');
    expect(calls).toHaveLength(1);
  });

  it('maps API errors to a short scrubbed message with the code', async () => {
    const { fb } = mk(() => ({ status: 400, json: { error: { message: `Invalid OAuth access token ${TOKEN} (access_token=${TOKEN})`, code: 190, error_subcode: 460 } } }));
    const e = (await fb.getPermalink('1').catch((x) => x)) as FbError;
    expect(e).toBeInstanceOf(FbError);
    expect(e.code).toBe(190);
    expect(e.message).toMatch(/^Facebook 400 \(code 190\/460\)/);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message.length).toBeLessThanOrEqual(300);
    expect(e.transient).toBe(false);
    expect(e.ambiguous).toBe(false);
  });

  it('classifies transient and ambiguous failures', async () => {
    const rate = (await mk(() => ({ status: 400, json: { error: { message: 'slow down', code: 4 } } })).fb.getPermalink('1').catch((x) => x)) as FbError;
    expect(rate.transient).toBe(true);
    expect(rate.ambiguous).toBe(false);
    const server = (await mk(() => ({ status: 503, json: {} })).fb.getPermalink('1').catch((x) => x)) as FbError;
    expect(server.transient).toBe(true);
    expect(server.ambiguous).toBe(true);
  });

  it('network failures are ambiguous and carry no URL or token', async () => {
    const boom = (async () => {
      throw new TypeError(`fetch failed https://graph.facebook.com/x?access_token=${TOKEN}`);
    }) as typeof fetch;
    const e = (await createFacebookClient({ token: TOKEN, pageId: 'PAGE', fetch: boom }).publishPhoto('u', 'c').catch((x) => x)) as FbError;
    expect(e.status).toBe(0);
    expect(e.ambiguous).toBe(true);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain('http');
  });
});

describe('facebookUnsupported', () => {
  const img = { kind: 'image' as const, public_url: 'i' };
  const vid = { kind: 'video' as const, public_url: 'v' };
  it('guards what the Pages API cannot take', () => {
    expect(facebookUnsupported({ type: 'story' }, [img])).toMatch(/Instagram only/);
    expect(facebookUnsupported({ type: 'carousel' }, [img, vid])).toMatch(/photos/);
    expect(facebookUnsupported({ type: 'carousel' }, [img])).toMatch(/two or more/);
    expect(facebookUnsupported({ type: 'reel' }, [img])).toMatch(/video/);
    expect(facebookUnsupported({ type: 'image' }, [])).toMatch(/no media/);
    expect(facebookUnsupported({ type: 'image' }, [img])).toBeNull();
    expect(facebookUnsupported({ type: 'reel' }, [vid])).toBeNull();
    expect(facebookUnsupported({ type: 'carousel' }, [img, img])).toBeNull();
  });
});
