import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) throw new Error('Versão inválida.');
// Explicit allowlist: credentials, scripts and browser profiles never enter the package.
const names = ['manifest.json', 'background.js', 'panel.html', 'panel.css', 'panel.js', 'settings.js', 'README.md', 'docs/verification.md', 'assets/model-catalog.json', 'assets/litellm-LICENSE.txt'];
for (const [directory, extension] of [['core', '.js'], ['content', '.js'], ['assets', '.png']]) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(extension)) names.push(`${directory}/${entry.name}`);
  }
}
names.sort();
const required = [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js)];
for (const name of required) if (!names.includes(name)) throw new Error(`Arquivo do manifest fora do pacote: ${name}`);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const local = [];
const central = [];
let offset = 0;
for (const name of names) {
  const path = resolve(root, name);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Arquivo inválido: ${name}`);
  const data = readFileSync(path);
  const filename = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  // ZIP stored entries need no external archiver. The date is deterministic (1980-01-01).
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  local.push(header, filename, data);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(33, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(data.length, 20);
  record.writeUInt32LE(data.length, 24);
  record.writeUInt16LE(filename.length, 28);
  record.writeUInt32LE(offset, 42);
  central.push(record, filename);
  offset += header.length + filename.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });
const output = resolve(dist, `TubeLess-${manifest.version}.zip`);
writeFileSync(output, archive);
console.log(`Pacote criado: ${output} (${names.length} arquivos, ${archive.length} bytes). Sem .env, testes ou perfis de navegador.`);
