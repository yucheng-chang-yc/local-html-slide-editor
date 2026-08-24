import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const store = path.resolve('node_modules', '.pnpm');
const outputDirectory = path.resolve('evidence', 'licenses');
const records = new Map();

async function addPackageJson(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data.name || !data.version) return;
    const license = typeof data.license === 'string'
      ? data.license
      : Array.isArray(data.licenses)
        ? data.licenses.map((item) => typeof item === 'string' ? item : item?.type).filter(Boolean).join(' OR ')
        : 'NOT_DECLARED';
    const repository = typeof data.repository === 'string' ? data.repository : data.repository?.url ?? data.homepage ?? '';
    records.set(`${data.name}@${data.version}`, { name: data.name, version: data.version, license, repository });
  } catch {
    // A package without readable metadata is reported by the completeness check below.
  }
}

for (const entry of await readdir(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const modules = path.join(store, entry.name, 'node_modules');
  let children;
  try { children = await readdir(modules, { withFileTypes: true }); } catch { continue; }
  for (const child of children) {
    if (!child.isDirectory()) continue;
    if (child.name.startsWith('@')) {
      for (const scoped of await readdir(path.join(modules, child.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) await addPackageJson(path.join(modules, child.name, scoped.name, 'package.json'));
      }
    } else {
      await addPackageJson(path.join(modules, child.name, 'package.json'));
    }
  }
}

const inventory = [...records.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
if (!inventory.length) throw new Error('找不到 frozen lockfile 的已安裝套件 metadata。');
const missing = inventory.filter((item) => item.license === 'NOT_DECLARED');
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'pnpm-license-inventory.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), packageCount: inventory.length, packages: inventory }, null, 2)}\n`, 'utf8');
const csv = ['Name,Version,License,Repository', ...inventory.map((item) => [item.name, item.version, item.license, item.repository].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
await writeFile(path.join(outputDirectory, 'pnpm-license-inventory.csv'), `${csv}\n`, 'utf8');
console.log(`License inventory PASS: ${inventory.length} exact package records, ${missing.length} without declared license.`);
if (missing.length) process.exitCode = 1;
