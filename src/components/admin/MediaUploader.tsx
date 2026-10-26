/**
 * Browser upload of a JPEG / MP4 / MOV to the Supabase `social` Storage bucket. The file never passes through a Vercel
 * Function (bodies are capped at 4.5 MB): the server hands out a one-time signed upload URL, the browser PUTs to
 * Storage, then the server registers the file in the media library. Width, height and length are read here with a
 * hidden <img>/<video> element. Not a <form>, so it can sit inside the post editor's form.
 */
import { useState } from 'preact/hooks';
import { MAX_UPLOAD_BYTES, isUploadMime } from '../../lib/social/forms';
import type { SocialMedia } from '../../lib/social/types';

export type LibraryMedia = Pick<SocialMedia, 'id' | 'kind' | 'public_url' | 'mime' | 'bytes' | 'width' | 'height' | 'duration_s' | 'alt_text'>;

interface Measured {
  width: number | null;
  height: number | null;
  duration_s: number | null;
}
const UNKNOWN: Measured = { width: null, height: null, duration_s: null };

function measure(file: File): Promise<Measured> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let finished = false;
    const done = (m: Measured) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      resolve(m);
    };
    setTimeout(() => done(UNKNOWN), 15000);
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight, duration_s: null });
      img.onerror = () => done(UNKNOWN);
      img.src = url;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => done({ width: v.videoWidth || null, height: v.videoHeight || null, duration_s: Number.isFinite(v.duration) ? v.duration : null });
      v.onerror = () => done(UNKNOWN);
      v.src = url;
    }
  });
}

function putFile(url: string, file: File, onProgress: (pct: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file); // Supabase's signed-upload convention: an unnamed file part
    xhr.send(body);
  });
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !data) return { ok: false, error: data?.error ?? `Request failed (${res.status}).` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Network error. Try again.' };
  }
}

const input = 'w-full rounded border border-stone-400 bg-white px-3 py-2 text-stone-900';

export default function MediaUploader(p: { onUploaded: (m: LibraryMedia) => void; idPrefix?: string }) {
  const id = p.idPrefix ?? 'up';
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [credit, setCredit] = useState('');
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = (f: File | null) => {
    setMsg(null);
    if (f && !isUploadMime(f.type)) {
      setFile(null);
      setMsg({ ok: false, text: 'Only JPEG photos and MP4 or MOV videos can be uploaded.' });
      return;
    }
    if (f && f.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setMsg({ ok: false, text: 'Files can be at most 50 MB.' });
      return;
    }
    setFile(f);
  };

  const upload = async () => {
    if (!file || !isUploadMime(file.type)) return;
    setBusy(true);
    setPct(0);
    setMsg({ ok: true, text: 'Reading the file…' });
    const m = await measure(file);
    setMsg({ ok: true, text: 'Uploading…' });
    const signed = await postJson<{ path: string; url: string }>('/admin/social/upload-url', { mime: file.type, bytes: file.size });
    if (!signed.ok) {
      setBusy(false);
      setMsg({ ok: false, text: signed.error });
      return;
    }
    if (!(await putFile(signed.data.url, file, setPct))) {
      setBusy(false);
      setMsg({ ok: false, text: 'The upload to storage failed. Try again.' });
      return;
    }
    const reg = await postJson<{ media: LibraryMedia }>('/admin/social/media', { storage_path: signed.data.path, mime: file.type, bytes: file.size, ...m, alt_text: alt, credit, license });
    setBusy(false);
    if (!reg.ok) {
      setMsg({ ok: false, text: reg.error });
      return;
    }
    const unmeasured = file.type.startsWith('video/') && m.duration_s === null;
    setMsg({ ok: true, text: unmeasured ? 'Uploaded, but this browser could not read the video length, so the post will fail its length check. Re-export as MP4 (H.264) and upload again.' : 'Uploaded and added to the library.' });
    setFile(null);
    setAlt('');
    p.onUploaded(reg.data.media);
  };

  return (
    <div class="space-y-3 rounded-lg border border-dashed border-stone-400 p-3">
      <p class="font-medium text-stone-900">Upload new media</p>
      <div>
        <label for={`${id}-file`} class="text-sm font-medium text-stone-800">File (JPEG, MP4 or MOV, up to 50 MB)</label>
        <input id={`${id}-file`} type="file" accept="image/jpeg,video/mp4,video/quicktime" disabled={busy} class={input} onChange={(e) => pick(e.currentTarget.files?.[0] ?? null)} />
      </div>
      <div>
        <label for={`${id}-alt`} class="text-sm font-medium text-stone-800">Alt text (describe the picture)</label>
        <input id={`${id}-alt`} type="text" maxLength={1000} value={alt} disabled={busy} class={input} onInput={(e) => setAlt(e.currentTarget.value)} />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label for={`${id}-credit`} class="text-sm font-medium text-stone-800">Credit (required if not made by RayValue)</label>
          <input id={`${id}-credit`} type="text" maxLength={300} value={credit} disabled={busy} class={input} onInput={(e) => setCredit(e.currentTarget.value)} />
        </div>
        <div>
          <label for={`${id}-license`} class="text-sm font-medium text-stone-800">License</label>
          <input id={`${id}-license`} type="text" maxLength={120} value={license} disabled={busy} class={input} onInput={(e) => setLicense(e.currentTarget.value)} />
        </div>
      </div>
      <button type="button" disabled={!file || busy} onClick={upload} class="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 py-2 font-semibold text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? `Uploading${pct ? ` ${pct}%` : '…'}` : 'Upload'}
      </button>
      <p role="status" aria-live="polite" class={`text-sm ${msg ? (msg.ok ? 'text-stone-800' : 'font-medium text-red-800') : ''}`}>{msg?.text ?? ''}</p>
    </div>
  );
}
