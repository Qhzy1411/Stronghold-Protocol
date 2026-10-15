#!/usr/bin/env node
// Build a browser-importable resource cache package without voice, BGM or SFX files.
// Usage: node tools/cache-package.mjs [--out <file>] [--root <directory>]

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../shared/constants.js';
import { CACHE_CORE_URLS, cacheGroupOf, normalizeCacheUrl } from '../shared/cacheGroups.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED_GROUPS = new Set(['voiceCn', 'voiceJp', 'audio']);
const MIME = {
  '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.atlas': 'text/plain', '.skel': 'application/octet-stream',
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function walk(value, out) {
  if (typeof value === 'string') {
    const normalized = normalizeCacheUrl(value);
    if (normalized && /^\/(?:assets|fonts)\//.test(normalized)) out.add(normalized);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) walk(item, out); return; }
  if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, out);
}

function relPath(url) {
  const p = normalizeCacheUrl(url);
  return p ? p.slice(1) : null;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(value >>> 0); return b; }

function zipEntry(name, body, offset) {
  const n = Buffer.from(name);
  const crc = crc32(body);
  const local = Buffer.concat([
    Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(body.length),
    u32(body.length), u16(n.length), u16(0), n, body,
  ]);
  const central = Buffer.concat([
    Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(body.length),
    u32(body.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n,
  ]);
  return { local, central };
}

async function main() {
  const root = path.resolve(arg('--root', ROOT));
  const output = path.resolve(arg('--out', path.join(root, `Stronghold-Protocol-cache-v${APP_VERSION}-no-audio.zip`)));
  const urls = new Set(CACHE_CORE_URLS);
  for (const name of ['assets.json', 'local-assets.json']) {
    const file = path.join(root, 'data', name);
    try { walk(JSON.parse(await fsp.readFile(file, 'utf8')), urls); } catch { /* optional local manifest */ }
  }
  const files = [];
  for (const url of [...urls].sort()) {
    const group = url.startsWith('/data/') || url.startsWith('/vendor/') ? 'core' : cacheGroupOf(url);
    if (EXCLUDED_GROUPS.has(group)) continue;
    const rel = relPath(url);
    if (!rel) continue;
    const abs = path.join(root, 'public', rel.startsWith('assets/') || rel.startsWith('fonts/') || rel.startsWith('vendor/') ? rel : `../${rel}`);
    const actual = rel.startsWith('data/') ? path.join(root, rel) : abs;
    if (!fs.existsSync(actual) || !fs.statSync(actual).isFile()) continue;
    files.push({ url, path: rel, file: actual, type: MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream' });
  }
  const manifest = Buffer.from(JSON.stringify({ format: 1, app: APP_VERSION, generatedAt: new Date().toISOString(), files: files.map(({ url, path: file, type }) => ({ url, path: file, type })) }));
  const chunks = [];
  const central = [];
  let offset = 0;
  const add = (name, body) => { const z = zipEntry(name, body, offset); chunks.push(z.local); central.push(z.central); offset += z.local.length; };
  add('sp-cache.json', manifest);
  let total = 0;
  for (const [i, item] of files.entries()) {
    const body = await fsp.readFile(item.file);
    add(item.path, body);
    total += body.length;
    if ((i + 1) % 500 === 0) console.log(`[cache-package] ${i + 1}/${files.length} files`);
  }
  const centralBody = Buffer.concat(central);
  const end = Buffer.concat([Buffer.from('PK\x05\x06', 'binary'), Buffer.alloc(4), u16(central.length), u16(central.length), u32(centralBody.length), u32(offset), Buffer.alloc(2)]);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, Buffer.concat([...chunks, centralBody, end]));
  console.log(`[cache-package] wrote ${output}`);
  console.log(`[cache-package] ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MiB, excluded voice/music/sfx`);
}

main().catch((err) => { console.error(`[cache-package] ${err?.stack || err}`); process.exitCode = 1; });
