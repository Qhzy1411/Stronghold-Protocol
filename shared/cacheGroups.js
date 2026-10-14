// Resource-cache groups shared by the browser cache manager and the Node static server.

import { splitHashedPath } from './assetPaths.js';

export const CACHE_CORE_URLS = Object.freeze([
  '/vendor/preact.module.js',
  '/vendor/hooks.module.js',
  '/vendor/htm.module.js',
  '/vendor/pixi.min.js',
  '/vendor/pixi-spine.js',
  '/data/config.json',
  '/data/assets.json',
  '/data/chess.json',
  '/data/bonds.json',
  '/data/items.json',
  '/data/bands.json',
  '/data/enemies.json',
  '/data/bosses.json',
  '/data/stages.json',
  '/data/tokens.json',
  '/data/choices.json',
  '/data/effects.json',
  '/data/garrisons.json',
  '/data/factions.json',
  '/data/local-assets.json',
  '/data/backups.json',
]);

export const CACHE_GROUP_RULES = Object.freeze([
  { id: 'ui', match: (path) => /\/(?:fonts\/|assets\/(?:ui|bond|item|band)\/)/.test(path) },
  { id: 'operators', match: (path) => /\/assets\/(?:char|skill|module|prof|spine\/op)\//.test(path) },
  { id: 'battle', match: (path) => /\/assets\/(?:enemy|token|spine\/(?:enemy|token))\//.test(path) },
  { id: 'voiceCn', match: (path) => /\/assets\/audio\/voice\/cn\//.test(path) },
  { id: 'voiceJp', match: (path) => /\/assets\/audio\/voice\/jp\//.test(path) },
  { id: 'audio', match: (path) => /\/assets\/audio\/(?:bgm|sfx)\//.test(path) },
  { id: 'local', match: (path) => /\/assets\/local\//.test(path) },
]);

export const CACHE_GROUP_IDS = Object.freeze(['core', ...CACHE_GROUP_RULES.map((rule) => rule.id)]);

/**
 * Remove query strings and the server's content-hash segment from an asset URL.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeCacheUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let path = value.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { /* keep the original path */ }
  return splitHashedPath(path).path;
}

/** @param {unknown} value @returns {string|null} */
export function cacheGroupOf(value) {
  const path = normalizeCacheUrl(value);
  if (!path) return null;
  return CACHE_GROUP_RULES.find((rule) => rule.match(path))?.id || 'ui';
}
