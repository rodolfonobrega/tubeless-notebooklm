import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 obrigatório');

const packaged = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...manifest.content_scripts.flatMap(script => script.js || []),
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
];
for (const path of packaged) {
  if (!path || !existsSync(resolve(root, path))) throw new Error(`Arquivo do manifest ausente: ${path}`);
}
function checkScripts(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !['tests', 'node_modules', '.git', 'dist', '.test-artifacts'].includes(entry.name)) checkScripts(path);
    else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  }
}
checkScripts(root);
console.log(`Manifest V3 válido: ${packaged.length} referências locais encontradas.`);
