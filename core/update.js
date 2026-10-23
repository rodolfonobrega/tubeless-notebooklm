// Checks the public GitHub releases of this project. Nothing is sent to GitHub besides the request itself.
export const REPOSITORY = 'rodolfonobrega/tubeless-notebooklm';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;

const parseVersion = version => String(version).replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);

export function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// The release zip must be the one named for its tag, and must come from this repository's releases.
export function pickZipAsset(release) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  const name = `TubeLess-${version}.zip`;
  const asset = (release?.assets || []).find(item => item?.name === name);
  if (!version || !asset || !String(asset.browser_download_url || '').startsWith(DOWNLOAD_PREFIX)) return null;
  return { version, name, url: asset.browser_download_url };
}

// Resolves to the newer release asset, or null when the installed version is current.
export async function checkForUpdate(currentVersion, fetchImpl = fetch) {
  const response = await fetchImpl(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`GitHub responded with HTTP ${response.status}.`);
  const asset = pickZipAsset(await response.json());
  return asset && isNewerVersion(asset.version, currentVersion) ? asset : null;
}
