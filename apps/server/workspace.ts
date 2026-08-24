import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { makeEditableHtml } from '../../packages/editor-core/html-patch.js';
import { extractSpeakerNotes } from '../../packages/editor-core/speaker-notes.js';
import { applyWorkspaceDocument, classifyCompatibility } from '../../packages/editor-core/workspace-document.js';
import { safeJoin, validateArchivePath } from '../../packages/editor-core/path-safety.js';
import type { PatchOperation } from '../../packages/editor-core/types.js';

export interface WorkspaceRecord {
  id: string;
  root: string;
  entry: string;
  kind: 'html' | 'zip';
  sourceHtml: string;
  currentHtml: string;
  editingBaseHtml: string;
  importedAt: string;
  updatedAt: string;
}

const dataRoot = path.resolve('.data', 'workspaces');
const records = new Map<string, WorkspaceRecord>();

async function writeMetadata(record: WorkspaceRecord): Promise<void> {
  const metadata = { ...record, root: undefined, sourceHtml: undefined, currentHtml: undefined, editingBaseHtml: undefined };
  await fs.writeFile(path.join(record.root, '.workspace.json'), JSON.stringify(metadata, null, 2), 'utf8');
}

async function persistRecord(record: WorkspaceRecord, snapshot = false): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(record.root, '.current.html'), record.currentHtml, 'utf8');
  await writeMetadata(record);
  if (!snapshot) return;
  const snapshotRoot = path.join(record.root, '.snapshots');
  await fs.mkdir(snapshotRoot, { recursive: true });
  const stamp = record.updatedAt.replace(/[:.]/g, '-');
  await fs.writeFile(path.join(snapshotRoot, `${stamp}.html`), record.currentHtml, 'utf8');
  const names = (await fs.readdir(snapshotRoot)).filter((name) => name.endsWith('.html')).sort().reverse();
  await Promise.all(names.slice(10).map((name) => fs.rm(path.join(snapshotRoot, name), { force: true })));
}

async function loadPersistedRecords(): Promise<void> {
  await fs.mkdir(dataRoot, { recursive: true });
  for (const id of await fs.readdir(dataRoot)) {
    const root = path.join(dataRoot, id);
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(root, '.workspace.json'), 'utf8')) as Omit<WorkspaceRecord, 'root' | 'sourceHtml' | 'currentHtml'>;
      const sourceHtml = await fs.readFile(path.join(root, '.original.html'), 'utf8');
      const currentHtml = await fs.readFile(path.join(root, '.current.html'), 'utf8').catch(() => sourceHtml);
      records.set(id, { ...metadata, id, root, sourceHtml, currentHtml, editingBaseHtml: currentHtml, updatedAt: metadata.updatedAt ?? metadata.importedAt });
    } catch {
      // Ignore incomplete folders left by an interrupted import.
    }
  }
}

function pickEntry(paths: string[]): string {
  const exact = paths.find((item) => item.toLowerCase() === 'index.html');
  const nested = paths.find((item) => item.toLowerCase().endsWith('/index.html'));
  const first = paths.find((item) => /\.html?$/i.test(item));
  if (!exact && !nested && !first) throw new Error('ZIP 中找不到 HTML 入口檔案。');
  return exact ?? nested ?? first!;
}

export async function importPayload(payload: { name: string; data: string; kind: 'html' | 'zip'; entry?: string }): Promise<WorkspaceRecord> {
  await fs.mkdir(dataRoot, { recursive: true });
  const id = randomUUID();
  const root = path.join(dataRoot, id);
  await fs.mkdir(root, { recursive: false });
  const buffer = Buffer.from(payload.data, 'base64');
  let entry: string;

  try {
    if (payload.kind === 'zip') {
      const zip = await JSZip.loadAsync(buffer, { createFolders: false });
      const files = Object.values(zip.files);
      const names: string[] = [];
      for (const file of files) {
        const originalName = (file as typeof file & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
        const normalized = validateArchivePath(originalName);
        if (normalized !== file.name.replaceAll('\\', '/').replace(/\/$/, '')) throw new Error(`ZIP 路徑經過未授權正規化：${originalName}`);
        const mode = file.unixPermissions;
        if (typeof mode === 'number' && (mode & 0o170000) === 0o120000) throw new Error(`ZIP 不允許符號連結：${file.name}`);
        if (file.dir) continue;
        names.push(normalized);
        const output = safeJoin(root, normalized);
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, await file.async('nodebuffer'));
      }
      entry = payload.entry ? validateArchivePath(payload.entry) : pickEntry(names);
      if (!names.includes(entry)) throw new Error('指定的入口檔案不存在。');
    } else {
      entry = validateArchivePath(payload.name || 'index.html');
      if (!/\.html?$/i.test(entry)) entry = 'index.html';
      await fs.writeFile(safeJoin(root, entry), buffer);
    }
    const sourceHtml = await fs.readFile(safeJoin(root, entry), 'utf8');
    const importedAt = new Date().toISOString();
    const record: WorkspaceRecord = { id, root, entry, kind: payload.kind, sourceHtml, currentHtml: sourceHtml, editingBaseHtml: sourceHtml, importedAt, updatedAt: importedAt };
    records.set(id, record);
    await writeMetadata(record);
    await fs.writeFile(path.join(root, '.original.html'), sourceHtml, 'utf8');
    await persistRecord(record, true);
    return record;
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

await loadPersistedRecords();

export function getWorkspace(id: string): WorkspaceRecord {
  const record = records.get(id);
  if (!record) throw new Error('工作區不存在或已失效。');
  return record;
}

export function editablePayload(record: WorkspaceRecord) {
  const baseHref = `/api/workspaces/${record.id}/files/${path.posix.dirname(record.entry) === '.' ? '' : `${path.posix.dirname(record.entry)}/`}`;
  const editable = makeEditableHtml(record.currentHtml, baseHref);
  return {
    id: record.id,
    entry: record.entry,
    html: editable.html,
    elements: editable.elements,
    speakerNotes: extractSpeakerNotes(record.currentHtml),
    compatibility: classifyCompatibility(record.sourceHtml),
  };
}

export function applyWorkspacePatches(record: WorkspaceRecord, operations: PatchOperation[]): string {
  const output = applyWorkspaceDocument(record.editingBaseHtml, operations);
  record.currentHtml = output;
  return output;
}

export async function saveWorkspacePatches(record: WorkspaceRecord, operations: PatchOperation[]): Promise<string> {
  const output = applyWorkspacePatches(record, operations);
  await persistRecord(record, true);
  return output;
}

export function latestWorkspace(): WorkspaceRecord | null {
  return [...records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function listWorkspaces() {
  return [...records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((record) => ({
    id: record.id, name: path.basename(record.entry), entry: record.entry, kind: record.kind,
    importedAt: record.importedAt, updatedAt: record.updatedAt, revision: 1,
  }));
}

export async function deleteWorkspace(id: string): Promise<void> {
  const record = getWorkspace(id);
  records.delete(id);
  await fs.rm(record.root, { recursive: true, force: true });
}

export async function listSnapshots(record: WorkspaceRecord): Promise<Array<{ id: string; createdAt: string }>> {
  const root = path.join(record.root, '.snapshots');
  const names = await fs.readdir(root).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith('.html')).sort().reverse().map((name) => ({
    id: name.slice(0, -5),
    createdAt: name.slice(0, -5).replace(/-(\d\d)-(\d\d)-(\d\d)-(\d\d\d)$/, ':$1:$2.$3$4'),
  }));
}

export async function restoreSnapshot(record: WorkspaceRecord, id: string): Promise<void> {
  if (!/^[\dTZ-]+$/.test(id)) throw new Error('快照識別碼無效。');
  const html = await fs.readFile(safeJoin(path.join(record.root, '.snapshots'), `${id}.html`), 'utf8');
  record.currentHtml = html;
  record.editingBaseHtml = html;
  await persistRecord(record, true);
}

export async function restoreOriginal(record: WorkspaceRecord): Promise<void> {
  record.currentHtml = record.sourceHtml;
  record.editingBaseHtml = record.sourceHtml;
  await persistRecord(record, true);
}

export async function addAsset(record: WorkspaceRecord, name: string, data: string): Promise<string> {
  const safeName = path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('圖片檔名無效。');
  const relative = `assets/user-${Date.now()}-${safeName}`;
  const output = safeJoin(record.root, relative);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, Buffer.from(data, 'base64'));
  return path.posix.relative(path.posix.dirname(record.entry), relative);
}

export async function exportWorkspace(record: WorkspaceRecord): Promise<{ buffer: Buffer; type: 'html' | 'zip'; name: string }> {
  if (record.kind === 'html') {
    return { buffer: Buffer.from(record.currentHtml), type: 'html', name: 'edited.html' };
  }
  const zip = new JSZip();
  const walk = async (dir: string): Promise<void> => {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await walk(absolute);
      else {
        const relative = path.relative(record.root, absolute).split(path.sep).join('/');
        zip.file(relative, relative === record.entry ? record.currentHtml : await fs.readFile(absolute));
      }
    }
  };
  await walk(record.root);
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), type: 'zip', name: 'edited-project.zip' };
}

export { classifyCompatibility };
