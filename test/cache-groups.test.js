import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheGroupOf, normalizeCacheUrl } from '../shared/cacheGroups.js';

test('cache groups ignore content-hash URL segments', () => {
  const hash = '0123456789abcdef';
  assert.equal(normalizeCacheUrl(`/assets/~${hash}/char/avatar/a.png`), '/assets/char/avatar/a.png');
  assert.equal(cacheGroupOf(`/assets/~${hash}/char/avatar/a.png`), 'operators');
  assert.equal(cacheGroupOf(`/assets/~${hash}/audio/voice/cn/a.mp3`), 'voiceCn');
  assert.equal(cacheGroupOf(`/assets/~${hash}/audio/voice/jp/a.mp3`), 'voiceJp');
  assert.equal(cacheGroupOf(`/assets/~${hash}/local/ui/a.png`), 'local');
  assert.equal(cacheGroupOf(`/fonts/~${hash}/bender.woff2`), 'ui');
});
