// Persistent resource cache for the optional Settings → cache manager.
//
// The browser's normal HTTP cache remains the first line of defence. This layer is deliberately opt-in: selected
// same-origin resources are copied into Cache Storage, and sw.js serves those copies on later visits. The cache name
// includes APP_VERSION so a released update gets a fresh namespace without deleting another site's data.

import { APP_VERSION } from '../../shared/constants.js';
import { N_ } from '../../shared/i18n.js';
import { data } from './data.js';

export const RESOURCE_CACHE_NAME = `sp-preload-${APP_VERSION}`;
const CACHE_PREFIX = 'sp-preload-';
const MAX_CONCURRENCY = 4;

const DATA_URLS = [
  ['config', 'config.json'], ['assets', 'assets.json'], ['chess', 'chess.json'], ['bonds', 'bonds.json'],
  ['items', 'items.json'], ['bands', 'bands.json'], ['enemies', 'enemies.json'], ['bosses', 'bosses.json'],
  ['stages', 'stages.json'], ['tokens', 'tokens.json'], ['choices', 'choices.json'], ['effects', 'effects.json'],
  ['garrisons', 'garrisons.json'], ['factions', 'factions.json'], ['local', 'local-assets.json'], ['backups', 'backups.json'],
].map(([, file]) => `/data/${file}`);

const CORE_URLS = [
  '/vendor/preact.module.js',
  '/vendor/hooks.module.js',
  '/vendor/htm.module.js',
  '/vendor/pixi.min.js',
  '/vendor/pixi-spine.js',
  ...DATA_URLS,
];

const GROUP_RULES = Object.freeze([
  { id: 'ui', label: N_('界面与教学素材'), micro: 'UI / GUIDE', match: (u) => /\/(?:fonts\/|assets\/(?:ui|bond|item|band)\/)/.test(u) },
  { id: 'operators', label: N_('干员资源'), micro: 'OPERATORS', match: (u) => /\/assets\/(?:char|skill|module|prof|spine\/op)\//.test(u) },
  { id: 'battle', label: N_('敌人与战场'), micro: 'BATTLE', match: (u) => /\/assets\/(?:enemy|token|spine\/(?:enemy|token))\//.test(u) },
  { id: 'voiceCn', label: N_('中文干员语音'), micro: 'VOICE CN', match: (u) => /\/assets\/audio\/voice\/cn\//.test(u) },
  { id: 'voiceJp', label: N_('日文干员语音'), micro: 'VOICE JP', match: (u) => /\/assets\/audio\/voice\/jp\//.test(u) },
  { id: 'audio', label: N_('背景音乐与音效'), micro: 'BGM / SFX', match: (u) => /\/assets\/audio\/(?:bgm|sfx)\//.test(u) },
  { id: 'local', label: N_('本地客户端素材'), micro: 'LOCAL ART', match: (u) => /\/assets\/local\//.test(u) },
]);

export const CACHE_GROUPS = Object.freeze([
  { id: 'core', label: N_('运行基础数据'), micro: 'CORE', static: true },
  ...GROUP_RULES.map(({ id, label, micro }) => ({ id, label, micro })),
]);

const groupById = new Map(CACHE_GROUPS.map((g) => [g.id, g]));

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

function resourceGroup(url) {
  return GROUP_RULES.find((r) => r.match(url))?.id || 'ui';
}

function groupShape(group, urls) {
  return { ...group, urls: [...urls].sort(), total: urls.size, cached: 0 };
}

/**
 * Build the current resource groups from the generated manifests.
 * @returns {Promise<Array<{ id: string, label: string, micro: string, urls: string[], total: number, cached: number }>>}
 */
export async function resourceGroups() {
  await Promise.all([data.load('assets'), data.load('local')]);
  const sets = new Map(CACHE_GROUPS.map((g) => [g.id, new Set()]));
  for (const url of CORE_URLS) sets.get('core').add(url);
  const urls = new Set();
  walkUrls(data.getRaw('assets'), urls);
  walkUrls(data.getRaw('local'), urls);
  for (const url of urls) sets.get(resourceGroup(url)).add(url);
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
    const cached = g.urls.reduce((n, u) => n + (stored.has(absoluteUrl(u)) ? 1 : 0), 0);
    return { ...g, cached };
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
  const wanted = new Set(groups.flatMap((g) => g.urls || []).map(sameUrl).filter(Boolean));
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
