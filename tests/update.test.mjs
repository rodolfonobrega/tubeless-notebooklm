import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion, pickZipAsset, checkForUpdate, LATEST_RELEASE_URL } from '../core/update.js';

const release = (tag, assets) => ({ tag_name: tag, assets });
const zip = (version, url = `https://github.com/rodolfonobrega/tubeless-notebooklm/releases/download/v${version}/TubeLess-${version}.zip`) => ({ name: `TubeLess-${version}.zip`, browser_download_url: url });

test('versions compare by number, not text', () => {
  assert.equal(isNewerVersion('1.10.0', '1.9.0'), true);
  assert.equal(isNewerVersion('1.8.0', '1.8.0'), false);
  assert.equal(isNewerVersion('v1.8.1', '1.8.0'), true);
  assert.equal(isNewerVersion('1.7.0', '1.8.0'), false);
  assert.equal(isNewerVersion('2.0', '1.9.9'), true);
});

test('the zip is taken only when it is named for the tag and comes from this repository', () => {
  assert.deepEqual(pickZipAsset(release('v1.8.1', [zip('1.8.1')])), { version: '1.8.1', name: 'TubeLess-1.8.1.zip', url: 'https://github.com/rodolfonobrega/tubeless-notebooklm/releases/download/v1.8.1/TubeLess-1.8.1.zip' });
  assert.equal(pickZipAsset(release('v1.8.1', [zip('1.8.0')])), null);
  assert.equal(pickZipAsset(release('v1.8.1', [zip('1.8.1', 'https://evil.example/TubeLess-1.8.1.zip')])), null);
  assert.equal(pickZipAsset(release('', [])), null);
});

test('checkForUpdate returns the asset only for a newer release and sends no credentials', async () => {
  let requested;
  const fetchImpl = async (url, options) => {
    requested = { url, options };
    return new Response(JSON.stringify(release('v1.9.0', [zip('1.9.0')])), { status: 200 });
  };
  const asset = await checkForUpdate('1.8.0', fetchImpl);
  assert.equal(requested.url, LATEST_RELEASE_URL);
  assert.equal(requested.options.credentials, 'omit');
  assert.equal(requested.options.redirect, 'error');
  assert.equal(asset.version, '1.9.0');

  assert.equal(await checkForUpdate('1.9.0', fetchImpl), null);
});

test('checkForUpdate reports a GitHub error instead of hiding it', async () => {
  await assert.rejects(checkForUpdate('1.8.0', async () => new Response('{}', { status: 403 })), /HTTP 403/);
});
