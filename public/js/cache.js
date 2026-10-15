// Persistent resource cache for the optional Settings → cache manager.
//
// The browser's normal HTTP cache remains the first line of defence. Selected same-origin resources, imported cache
// packages and successful art downloads are copied into Cache Storage; sw.js serves those copies on later visits.
// The cache name includes APP_VERSION so a released update gets a fresh namespace without deleting another site's data.

import { APP_VERSION } from '../../shared/constants.js';
import { N_ } from '../../shared/i18n.js';
import {
  CACHE_CORE_URLS, cacheGroupOf, normalizeCacheUrl,
} from '../../shared/cacheGroups.js';
import { splitHashedPath } from '../../shared/assetPaths.js';
import { AUDIO_EXTS } from '../../shared/media.js';
import { data } from './data.js';

export const RESOURCE_CACHE_NAME = `sp-preload-${APP_VERSION}`;
const MAX_CONCURRENCY = 4;

export const CACHE_GROUPS = Object.freeze([
  { id: 'core', label: N_('运行基础数据'), micro: 'CORE', static: true },
  { id: 'ui', label: N_('界面与教学素材'), micro: 'UI / GUIDE' },
  { id: 'operators', label: N_('干员资源'), micro: 'OPERATORS' },
  { id: 'battle', label: N_('敌人与战场'), micro: 'BATTLE' },
  { id: 'voiceCn', label: N_('中文干员语音'), micro: 'VOICE CN' },
  { id: 'voiceJp', label: N_('日文干员语音'), micro: 'VOICE JP' },
  { id: 'audio', label: N_('背景音乐与音效'), micro: 'BGM / SFX' },
  { id: 'local', label: N_('本地客户端素材'), micro: 'LOCAL ART' },
]);

const groupById = new Map(CACHE_GROUPS.map((g) => [g.id, g]));
const CACHE_SIZE_URL = '/data/cache-sizes.json';
const CACHE_PACKAGE_NAME = 'sp-cache.json';
let resourceSizeIndex = null;

function isAssetUrl(value) {
  return typeof value === 'string' && /^\/(?:assets|fonts)\//.test(value);
}

function walkUrls(value, out) {
  if (typeof value === 'string') {
    if (isAssetUrl(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkUrls(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const item of Object.values(value)) walkUrls(item, out);
}

function absoluteUrl(url) {
  try { return new URL(url, globalThis.location?.href || 'http://localhost/').href; } catch { return null; }
}

function sameUrl(url) {
  const abs = absoluteUrl(url);
  if (!abs) return null;
  try {
    const site = globalThis.location?.origin;
    if (site && new URL(abs).origin !== site) return null;
  } catch { return null; }
  return abs;
}

function groupShape(group, urls) {
  const list = [...urls].sort();
  const bytes = resourceSizeIndex ? list.reduce((n, url) => n + (resourceSizeIndex.get(normalizeCacheUrl(url)) || 0), 0) : 0;
  const sizeKnown = !!resourceSizeIndex && list.every((url) => resourceSizeIndex.has(normalizeCacheUrl(url)));
  return { ...group, urls: list, total: urls.size, cached: 0, bytes, cachedBytes: 0, sizeKnown };
}

async function loadResourceSizeIndex() {
  try {
    const res = await fetch(CACHE_SIZE_URL, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res?.ok) throw new Error(`HTTP ${res?.status || '???'}`);
    const body = await res.json();
    const files = body && typeof body.files === 'object' ? body.files : null;
    if (!files) throw new Error('invalid cache size manifest');
    const next = new Map();
    for (const [url, bytes] of Object.entries(files)) {
      const key = normalizeCacheUrl(url);
      if (key && Number.isFinite(bytes) && bytes >= 0) next.set(key, bytes);
    }
    resourceSizeIndex = next;
  } catch (err) {
    resourceSizeIndex = null;
    console.warn('[cache] size manifest unavailable', err?.message || err);
  }
  return resourceSizeIndex;
}

/**
 * Build the current resource groups from the generated manifests.
 * @returns {Promise<Array<{ id: string, label: string, micro: string, urls: string[], total: number, cached: number, bytes: number, cachedBytes: number, sizeKnown: boolean }>>}
 */
export async function resourceGroups() {
  await Promise.all([data.load('assets'), data.load('local'), loadResourceSizeIndex()]);
  const sets = new Map(CACHE_GROUPS.map((g) => [g.id, new Set()]));
  for (const url of CACHE_CORE_URLS) sets.get('core').add(url);
  const urls = new Set();
  walkUrls(data.getRaw('assets'), urls);
  walkUrls(data.getRaw('local'), urls);
  for (const url of urls) sets.get(cacheGroupOf(url)).add(url);
  return CACHE_GROUPS.map((g) => groupShape(g, sets.get(g.id)));
}

async function openCache() {
  if (!globalThis.caches?.open) return null;
  return globalThis.caches.open(RESOURCE_CACHE_NAME);
}

async function cacheKeys(cache) {
  if (!cache) return [];
  try { return await cache.keys(); } catch { return []; }
}

function keyUrl(req) {
  const value = typeof req === 'string' ? req : req?.url;
  return absoluteUrl(value);
}

function zipText(bytes) { return new TextDecoder().decode(bytes); }

async function inflateZip(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8 || typeof DecompressionStream !== 'function') throw new Error('此浏览器不支持该缓存包的压缩格式');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readU16(view, at) { return view.getUint16(at, true); }
function readU32(view, at) { return view.getUint32(at, true); }

/** Read the central directory of a normal ZIP (stored or Deflate entries, no encryption/ZIP64). */
async function readZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 0x10000 - 22);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的缓存 ZIP');
  const count = readU16(view, eocd + 10);
  const dirSize = readU32(view, eocd + 12);
  const dirAt = readU32(view, eocd + 16);
  const out = [];
  let p = dirAt;
  for (let i = 0; i < count; i++) {
    if (readU32(view, p) !== 0x02014b50) throw new Error('缓存 ZIP 目录损坏');
    const method = readU16(view, p + 10);
    const compressed = readU32(view, p + 20);
    const nameLen = readU16(view, p + 28);
    const extraLen = readU16(view, p + 30);
    const commentLen = readU16(view, p + 32);
    const localAt = readU32(view, p + 42);
    const name = zipText(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/') || name.includes('..') || name.startsWith('/')) continue;
    if (readU32(view, localAt) !== 0x04034b50) throw new Error('缓存 ZIP 文件头损坏');
    const localNameLen = readU16(view, localAt + 26);
    const localExtraLen = readU16(view, localAt + 28);
    const start = localAt + 30 + localNameLen + localExtraLen;
    out.push({ name, method, bytes: await inflateZip(bytes.subarray(start, start + compressed), method) });
  }
  if (p < dirAt || dirSize < 0) throw new Error('缓存 ZIP 目录越界');
  return out;
}

function packagePath(url) {
  const path = normalizeCacheUrl(url);
  if (!path || !/^\/(?:assets|fonts|data|vendor)\//.test(path)) return null;
  return path.slice(1);
}

/** Import a cache package produced by tools/cache-package.mjs. */
export async function importCachePackage(file, onProgress) {
  const entries = await readZip(file);
  const manifestEntry = entries.find((entry) => entry.name === CACHE_PACKAGE_NAME);
  if (!manifestEntry) throw new Error('缓存包缺少 sp-cache.json');
  const manifest = JSON.parse(zipText(manifestEntry.bytes));
  if (manifest.format !== 1 || manifest.app !== APP_VERSION || !Array.isArray(manifest.files)) {
    throw new Error(`缓存包版本不匹配（需要 ${APP_VERSION}）`);
  }
  const cache = await openCache();
  if (!cache) throw new Error('当前地址不支持导入应用缓存');
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  let done = 0, ok = 0, failed = 0;
  for (const fileInfo of manifest.files) {
    const url = sameUrl(fileInfo.url);
    const path = packagePath(fileInfo.url);
    const entry = path ? byName.get(path) : null;
    try {
      if (!url || !entry) throw new Error('文件缺失');
      await cache.put(url, new Response(entry.bytes, { headers: { 'Content-Type': fileInfo.type || 'application/octet-stream' } }));
      ok++;
    } catch (err) {
      failed++;
      console.warn('[cache] package entry unavailable', fileInfo.url, err?.message || err);
    } finally {
      done++;
      try { onProgress?.({ done, total: manifest.files.length, ok, failed, url: fileInfo.url }); } catch { /* UI only */ }
    }
  }
  return { supported: true, done, total: manifest.files.length, ok, failed };
}

/** The audio manager fetches /media/... while manifests list /assets/audio/...mp3. */
function cacheAliases(url) {
  const abs = absoluteUrl(url);
  if (!abs) return [];
  const out = [abs];
  try {
    const parsed = new URL(abs);
    const { hash, path } = splitHashedPath(parsed.pathname);
    if (hash) {
      parsed.pathname = path;
      out.push(parsed.href);
    }
    if (path.startsWith('/assets/audio/')) {
      const ext = AUDIO_EXTS.find((suffix) => path.toLowerCase().endsWith(suffix));
      if (ext) {
        parsed.pathname = `/media/${hash ? `~${hash}/` : ''}${path.slice('/assets/audio/'.length, -ext.length)}`;
        out.push(parsed.href);
      }
    } else if (path.startsWith('/media/')) {
      parsed.pathname = `/assets/${hash ? `~${hash}/` : ''}audio/${path.slice('/media/'.length)}`;
      const ext = AUDIO_EXTS.find((suffix) => parsed.pathname.toLowerCase().endsWith(suffix));
      if (!ext) return out;
      parsed.pathname += ext;
      out.push(parsed.href);
    }
  } catch { /* invalid URL already handled by absoluteUrl */ }
  return out;
}

/**
 * Register the cache service worker. It is safe to call more than once and deliberately does not block boot.
 * @returns {Promise<{ supported: boolean, registration?: ServiceWorkerRegistration }>}
 */
export async function registerResourceCache() {
  const hostname = globalThis.location?.hostname;
  const localOrigin = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  if (!globalThis.navigator?.serviceWorker || (!globalThis.isSecureContext && !localOrigin)) {
    return { supported: false };
  }
  try {
    const registration = await globalThis.navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: '/' });
    registration.update?.().catch?.(() => {});
    return { supported: true, registration };
  } catch (err) {
    console.warn('[cache] service worker unavailable', err?.message || err);
    return { supported: false };
  }
}

/**
 * Return how many current URLs are in the app cache.
 * @param {Array<{ id: string, urls: string[] }>} groups
 */
export async function cacheStatus(groups) {
  const cache = await openCache();
  const keys = await cacheKeys(cache);
  const stored = new Set(keys.map(keyUrl).filter(Boolean));
  const result = groups.map((g) => {
    const cached = g.urls.reduce((n, u) => n + (cacheAliases(u).some((key) => stored.has(key)) ? 1 : 0), 0);
    const cachedBytes = g.urls.reduce((n, u) => n + (cacheAliases(u).some((key) => stored.has(key))
      ? (resourceSizeIndex?.get(normalizeCacheUrl(u)) || 0) : 0), 0);
    return { ...g, cached, cachedBytes };
  });
  return { supported: !!cache, groups: result, stored: stored.size };
}

/**
 * Download selected groups into Cache Storage. Existing entries are skipped.
 * @param {Array<{ id: string, urls: string[] }>} groups
 * @param {(progress: { done: number, total: number, ok: number, failed: number, url: string }) => void} [onProgress]
 */
export async function preloadGroups(groups, onProgress) {
  const cache = await openCache();
  const urls = [...new Set(groups.flatMap((g) => g.urls || []).map(sameUrl).filter(Boolean))];
  if (!cache) {
    // Cache Storage / service workers are unavailable on an insecure LAN origin. Still warm the browser's normal
    // HTTP cache so the same page benefits immediately; the UI reports that persistent clearing is unavailable.
    let done = 0, ok = 0, failed = 0, cursor = 0;
    const worker = async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        try {
          const res = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
          if (!res?.ok) throw new Error(`HTTP ${res?.status || '???'}`);
          ok++;
        } catch (err) {
          failed++;
          console.warn(`[cache] ${url} unavailable`, err?.message || err);
        } finally {
          done++;
          try { onProgress?.({ done, total: urls.length, ok, failed, url }); } catch { /* UI only */ }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, urls.length)) }, worker));
    return { supported: false, done, total: urls.length, ok, failed };
  }
  const existing = new Set((await cacheKeys(cache)).map(keyUrl).filter(Boolean));
  const queue = urls.filter((u) => !existing.has(u));
  let cursor = 0;
  let done = urls.length - queue.length;
  let ok = done;
  let failed = 0;
  const report = (url) => { try { onProgress?.({ done, total: urls.length, ok, failed, url }); } catch { /* UI only */ } };
  for (const url of urls) if (existing.has(url)) report(url);

  const worker = async () => {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      try {
        const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
        if (!res?.ok) throw new Error(`HTTP ${res?.status || '???'}`);
        await cache.put(url, res.clone());
        ok++;
      } catch (err) {
        failed++;
        console.warn(`[cache] ${url} unavailable`, err?.message || err);
      } finally {
        done++;
        report(url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, queue.length)) }, worker));
  return { supported: true, done, total: urls.length, ok, failed };
}

/**
 * Delete the selected groups. With no groups, delete the whole app cache.
 * @param {Array<{ urls: string[] }>} [groups]
 */
export async function clearResourceCache(groups = null) {
  if (!globalThis.caches?.open) return { supported: false, removed: 0 };
  if (!groups) {
    const removed = await globalThis.caches.delete(RESOURCE_CACHE_NAME);
    return { supported: true, removed: removed ? 1 : 0 };
  }
  const cache = await openCache();
  if (!cache) return { supported: false, removed: 0 };
  const wanted = new Set(groups.flatMap((g) => g.urls || []).flatMap(cacheAliases));
  let removed = 0;
  for (const req of await cacheKeys(cache)) {
    if (wanted.has(keyUrl(req)) && await cache.delete(req)) removed++;
  }
  return { supported: true, removed };
}

/** Match a persisted selection against current groups. */
export function validCacheGroupIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter((id) => groupById.has(id)))];
}
