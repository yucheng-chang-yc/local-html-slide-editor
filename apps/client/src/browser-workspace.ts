import JSZip from 'jszip';
import { makeEditableHtml } from '../../../packages/editor-core/html-patch';
import { extractSpeakerNotes } from '../../../packages/editor-core/speaker-notes';
import { applyWorkspaceDocument, classifyCompatibility } from '../../../packages/editor-core/workspace-document';
import type { PatchOperation } from '../../../packages/editor-core/types';
import type { StorageDiagnostics, WorkspaceAdapter, WorkspacePayload, WorkspaceSnapshot, WorkspaceSummary } from '../../../packages/workspace/types';

export const BROWSER_DB_NAME = 'local-html-slide-editor';
export const BROWSER_SCHEMA_VERSION = 3;
const MAX_SNAPSHOTS = 10;
const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

interface BrowserWorkspaceRecord extends WorkspaceSummary {
  sourceHtml: string;
  currentHtml: string;
  editingBaseHtml: string;
  checksum: string;
  assets: Record<string, ArrayBuffer>;
  storageBackend: 'indexeddb+opfs' | 'indexeddb-fallback';
}

interface SnapshotRecord {
  key: string;
  workspaceId: string;
  id: string;
  revision: number;
  createdAt: string;
  html: string;
  checksum: string;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('瀏覽器儲存操作失敗。'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('瀏覽器儲存交易失敗。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('瀏覽器儲存交易已取消。'));
  });
}

export function openBrowserDatabase(name = BROWSER_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, BROWSER_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('workspaces')) database.createObjectStore('workspaces', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('snapshots')) {
        const snapshots = database.createObjectStore('snapshots', { keyPath: 'key' });
        snapshots.createIndex('workspaceId', 'workspaceId', { unique: false });
      } else {
        const snapshots = request.transaction!.objectStore('snapshots');
        if (!snapshots.indexNames.contains('workspaceId')) snapshots.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      request.transaction!.objectStore('meta').put(BROWSER_SCHEMA_VERSION, 'schemaVersion');
    };
    request.onsuccess = () => {
      const database = request.result;
      // Let a later tab or release advance the schema instead of leaving the
      // versionchange transaction blocked by a stale editor connection.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('無法開啟瀏覽器工作區。'));
    request.onblocked = () => reject(new Error('瀏覽器工作區升級被其他分頁阻擋；請關閉舊分頁後重試。'));
  });
}

function normalizePath(input: string): string {
  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`ZIP 路徑不安全：${input}`);
  }
  return normalized;
}

function dirname(input: string): string {
  const index = input.lastIndexOf('/');
  return index < 0 ? '' : input.slice(0, index);
}

function relativeFromEntry(entry: string, target: string): string {
  const depth = dirname(entry).split('/').filter(Boolean).length;
  return `${'../'.repeat(depth)}${target}`;
}

function resolveRelative(baseFile: string, relative: string): string {
  const path = relative.split(/[?#]/, 1)[0];
  const stack = dirname(baseFile).split('/').filter(Boolean);
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop(); else stack.push(part);
  }
  return stack.join('/');
}

function pickEntry(paths: string[]): string {
  const entry = paths.find((item) => item.toLowerCase() === 'index.html')
    ?? paths.find((item) => item.toLowerCase().endsWith('/index.html'))
    ?? paths.find((item) => /\.html?$/i.test(item));
  if (!entry) throw new Error('ZIP 中找不到 HTML 入口檔案。');
  return entry;
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function mimeForPath(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return ({ css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', json: 'application/json', txt: 'text/plain' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('無法讀取資產。'));
    reader.readAsDataURL(blob);
  });
}

async function assetDataUrls(assets: Record<string, ArrayBuffer>): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  await Promise.all(Object.entries(assets).map(async ([path, bytes]) => {
    urls.set(path, await blobToDataUrl(new Blob([bytes], { type: mimeForPath(path) })));
  }));
  for (const [path, bytes] of Object.entries(assets)) {
    if (!/\.css$/i.test(path)) continue;
    let css = new TextDecoder().decode(bytes);
    css = css.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (whole, quote: string, raw: string) => {
      if (/^(?:data:|blob:|https?:|#)/i.test(raw)) return whole;
      return `url("${urls.get(resolveRelative(path, raw)) ?? raw}")`;
    });
    urls.set(path, `data:text/css;charset=utf-8,${encodeURIComponent(css)}`);
  }
  return urls;
}

async function hydrateAssets(html: string, entry: string, assets: Record<string, ArrayBuffer>): Promise<string> {
  const urls = await assetDataUrls(assets);
  return html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (whole, attribute: string, quote: string, raw: string) => {
    if (/^(?:data:|blob:|https?:|mailto:|#|javascript:)/i.test(raw)) return whole;
    const replacement = urls.get(resolveRelative(entry, raw));
    return replacement ? `${attribute}=${quote}${replacement}${quote}` : whole;
  }).replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (whole, quote: string, raw: string) => {
    if (/^(?:data:|blob:|https?:|#)/i.test(raw)) return whole;
    const replacement = urls.get(resolveRelative(entry, raw));
    return replacement ? `url("${replacement}")` : whole;
  });
}

async function payload(record: BrowserWorkspaceRecord): Promise<WorkspacePayload> {
  if (await sha256(record.currentHtml) !== record.checksum) {
    throw new Error('工作區內容校驗失敗。請從「復原版本」選擇快照，或重新匯入可攜式 HTML／ZIP 備份。');
  }
  const editable = makeEditableHtml(record.currentHtml, './');
  return {
    id: record.id,
    entry: record.entry,
    html: await hydrateAssets(editable.html, record.entry, record.assets),
    previewHtml: await hydrateAssets(record.currentHtml, record.entry, record.assets),
    elements: editable.elements,
    speakerNotes: extractSpeakerNotes(record.currentHtml),
    compatibility: classifyCompatibility(record.sourceHtml),
    revision: record.revision,
  };
}

function quotaError(error: unknown): Error {
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
    return new Error('瀏覽器儲存空間不足；目前修改未被靜默覆寫。請先匯出 HTML／ZIP 備份，再刪除不需要的網站資料。');
  }
  return error instanceof Error ? error : new Error('瀏覽器工作區寫入失敗。');
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  const forcedFallback = new URLSearchParams(location.search).get('storage') === 'idb';
  if (forcedFallback || !isSecureContext || !navigator.storage?.getDirectory) return null;
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}

async function mirrorToOpfs(record: BrowserWorkspaceRecord): Promise<boolean> {
  const root = await opfsRoot();
  if (!root) return false;
  try {
    const app = await root.getDirectoryHandle('local-html-slide-editor', { create: true });
    const directory = await app.getDirectoryHandle(record.id, { create: true });
    const documentFile = await directory.getFileHandle('current.html', { create: true });
    const writable = await documentFile.createWritable();
    await writable.write(record.currentHtml);
    await writable.close();
    const assetsDirectory = await directory.getDirectoryHandle('assets', { create: true });
    for (const [path, bytes] of Object.entries(record.assets)) {
      const safeName = `${await sha256(path)}-${path.split('/').at(-1)!.replace(/[^a-z0-9._-]/gi, '_')}`;
      const file = await assetsDirectory.getFileHandle(safeName, { create: true });
      const assetWriter = await file.createWritable();
      await assetWriter.write(bytes);
      await assetWriter.close();
    }
    return true;
  } catch { return false; }
}

async function deleteFromOpfs(workspaceId: string): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  try {
    const app = await root.getDirectoryHandle('local-html-slide-editor');
    await app.removeEntry(workspaceId, { recursive: true });
  } catch { /* Already absent or unavailable. */ }
}

async function download(blob: Blob, name: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rewriteEphemeralAssets(operations: PatchOperation[], replacements: Map<string, string>): PatchOperation[] {
  const replace = (value: string) => {
    let result = value;
    for (const [ephemeral, path] of replacements) result = result.replaceAll(ephemeral, path);
    return result;
  };
  return operations.map((operation): PatchOperation => {
    if (operation.type === 'insertElement' || operation.type === 'replaceChildren') return { ...operation, html: replace(operation.html) };
    if (operation.type === 'replaceInnerHtml' || operation.type === 'setAttribute') return { ...operation, value: replace(operation.value) };
    return operation;
  });
}

export class BrowserWorkspaceAdapter implements WorkspaceAdapter {
  readonly runtime = 'browser' as const;
  private databasePromise: Promise<IDBDatabase>;
  private revisions = new Map<string, number>();
  private ephemeralAssets = new Map<string, Map<string, string>>();

  constructor(databaseName = BROWSER_DB_NAME) { this.databasePromise = openBrowserDatabase(databaseName); }

  private async database(): Promise<IDBDatabase> { return this.databasePromise; }

  private async getRecord(id: string): Promise<BrowserWorkspaceRecord> {
    const database = await this.database();
    const transaction = database.transaction('workspaces', 'readonly');
    const record = await requestValue(transaction.objectStore('workspaces').get(id)) as BrowserWorkspaceRecord | undefined;
    await transactionDone(transaction);
    if (!record) throw new Error('工作區不存在，可能已在另一個分頁中刪除。');
    for (const [path, value] of Object.entries(record.assets)) {
      if (value instanceof Blob) record.assets[path] = await value.arrayBuffer();
    }
    return record;
  }

  private async putWithSnapshot(record: BrowserWorkspaceRecord): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(['workspaces', 'snapshots'], 'readwrite');
    transaction.objectStore('workspaces').put(record);
    const snapshot: SnapshotRecord = {
      key: `${record.id}:${String(record.revision).padStart(12, '0')}`,
      workspaceId: record.id,
      id: String(record.revision).padStart(12, '0'),
      revision: record.revision,
      createdAt: record.updatedAt,
      html: record.currentHtml,
      checksum: record.checksum,
    };
    transaction.objectStore('snapshots').put(snapshot);
    await transactionDone(transaction).catch((error) => { throw quotaError(error); });
    const snapshots = await this.snapshotRecords(record.id);
    if (snapshots.length > MAX_SNAPSHOTS) {
      const prune = database.transaction('snapshots', 'readwrite');
      snapshots.slice(MAX_SNAPSHOTS).forEach((item) => prune.objectStore('snapshots').delete(item.key));
      await transactionDone(prune);
    }
    const mirrored = await mirrorToOpfs(record);
    if (mirrored !== (record.storageBackend === 'indexeddb+opfs')) {
      record.storageBackend = mirrored ? 'indexeddb+opfs' : 'indexeddb-fallback';
      const update = database.transaction('workspaces', 'readwrite');
      update.objectStore('workspaces').put(record);
      await transactionDone(update);
    }
  }

  private async snapshotRecords(workspaceId: string): Promise<SnapshotRecord[]> {
    const database = await this.database();
    const transaction = database.transaction('snapshots', 'readonly');
    const records = await requestValue(transaction.objectStore('snapshots').index('workspaceId').getAll(workspaceId)) as SnapshotRecord[];
    await transactionDone(transaction);
    return records.sort((left, right) => right.revision - left.revision);
  }

  async importFile(file: File): Promise<WorkspacePayload> {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('檔案超過 80 MB 的瀏覽器匯入上限；請先縮減資產或使用本機 Node 模式。');
    const bytes = await file.arrayBuffer();
    const kind = file.name.toLowerCase().endsWith('.zip') ? 'zip' : 'html';
    const assets: Record<string, ArrayBuffer> = {};
    let entry = normalizePath(file.name || 'index.html');
    let sourceHtml: string;
    if (kind === 'zip') {
      const zip = await JSZip.loadAsync(bytes, { createFolders: false });
      const names: string[] = [];
      let assetBytes = 0;
      for (const zipped of Object.values(zip.files)) {
        const originalName = (zipped as typeof zipped & { unsafeOriginalName?: string }).unsafeOriginalName ?? zipped.name;
        const path = normalizePath(originalName);
        if (path !== zipped.name.replaceAll('\\', '/').replace(/\/$/, '')) throw new Error(`ZIP 路徑經過未授權正規化：${originalName}`);
        if (zipped.dir) continue;
        names.push(path);
        const asset = await zipped.async('arraybuffer');
        assetBytes += asset.byteLength;
        if (assetBytes > MAX_ASSET_BYTES) throw new Error('ZIP 解壓後資產超過 64 MB 的瀏覽器安全上限。');
        assets[path] = asset;
      }
      entry = pickEntry(names);
      sourceHtml = new TextDecoder().decode(assets[entry]);
      delete assets[entry];
    } else {
      if (!/\.html?$/i.test(entry)) entry = 'index.html';
      sourceHtml = new TextDecoder().decode(bytes);
    }
    const contentHash = await sha256(bytes);
    const id = `workspace-${contentHash.slice(0, 24)}`;
    try {
      const existing = await this.getRecord(id);
      this.revisions.set(id, existing.revision);
      return payload(existing);
    } catch { /* New deterministic workspace. */ }
    const now = new Date().toISOString();
    const record: BrowserWorkspaceRecord = {
      id, name: file.name, entry, kind, importedAt: now, updatedAt: now, revision: 1,
      sourceHtml, currentHtml: sourceHtml, editingBaseHtml: sourceHtml,
      checksum: await sha256(sourceHtml), assets, storageBackend: 'indexeddb-fallback',
    };
    await this.putWithSnapshot(record);
    this.revisions.set(id, record.revision);
    return payload(record);
  }

  async uploadAsset(workspaceId: string, file: File): Promise<string> {
    const record = await this.getRecord(workspaceId);
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    if (!safeName) throw new Error('圖片檔名無效。');
    const relative = `assets/user-${String(record.revision + 1).padStart(6, '0')}-${safeName}`;
    const bytes = await file.arrayBuffer();
    record.assets[relative] = bytes;
    record.updatedAt = new Date().toISOString();
    const url = await blobToDataUrl(new Blob([bytes], { type: file.type || mimeForPath(relative) }));
    const replacements = this.ephemeralAssets.get(workspaceId) ?? new Map<string, string>();
    replacements.set(url, relativeFromEntry(record.entry, relative));
    this.ephemeralAssets.set(workspaceId, replacements);
    const database = await this.database();
    const transaction = database.transaction('workspaces', 'readwrite');
    transaction.objectStore('workspaces').put(record);
    await transactionDone(transaction).catch((error) => { throw quotaError(error); });
    return url;
  }

  async saveDraft(workspaceId: string, operations: PatchOperation[]): Promise<WorkspacePayload> {
    const record = await this.getRecord(workspaceId);
    const expected = this.revisions.get(workspaceId) ?? record.revision;
    if (record.revision !== expected) throw new Error('另一個分頁已儲存較新的版本；目前修改未覆寫該版本。請重新載入後再編輯。');
    const rewritten = rewriteEphemeralAssets(operations, this.ephemeralAssets.get(workspaceId) ?? new Map());
    record.currentHtml = applyWorkspaceDocument(record.editingBaseHtml, rewritten);
    record.revision += 1;
    record.updatedAt = new Date().toISOString();
    record.checksum = await sha256(record.currentHtml);
    await this.putWithSnapshot(record);
    this.revisions.set(workspaceId, record.revision);
    return payload(record);
  }

  async loadLastSession(): Promise<WorkspacePayload | null> {
    const workspaces = await this.listWorkspaces();
    if (!workspaces.length) return null;
    const record = await this.getRecord(workspaces[0].id);
    this.revisions.set(record.id, record.revision);
    return payload(record);
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const database = await this.database();
    const transaction = database.transaction('workspaces', 'readonly');
    const records = await requestValue(transaction.objectStore('workspaces').getAll()) as BrowserWorkspaceRecord[];
    await transactionDone(transaction);
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(({ id, name, entry, kind, importedAt, updatedAt, revision }) => ({ id, name, entry, kind, importedAt, updatedAt, revision }));
  }

  async listSnapshots(workspaceId: string): Promise<WorkspaceSnapshot[]> {
    return (await this.snapshotRecords(workspaceId)).map(({ id, createdAt, revision }) => ({ id, createdAt, revision }));
  }

  async restoreWorkspace(workspaceId: string, snapshot?: string): Promise<WorkspacePayload> {
    const record = await this.getRecord(workspaceId);
    if (snapshot) {
      const selected = (await this.snapshotRecords(workspaceId)).find((item) => item.id === snapshot);
      if (!selected || await sha256(selected.html) !== selected.checksum) throw new Error('所選快照不存在或校驗失敗；請選擇其他版本或重新匯入備份。');
      record.currentHtml = selected.html;
    } else record.currentHtml = record.sourceHtml;
    record.editingBaseHtml = record.currentHtml;
    record.revision += 1;
    record.updatedAt = new Date().toISOString();
    record.checksum = await sha256(record.currentHtml);
    await this.putWithSnapshot(record);
    this.revisions.set(workspaceId, record.revision);
    return payload(record);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const database = await this.database();
    const snapshots = await this.snapshotRecords(workspaceId);
    const transaction = database.transaction(['workspaces', 'snapshots'], 'readwrite');
    transaction.objectStore('workspaces').delete(workspaceId);
    snapshots.forEach((item) => transaction.objectStore('snapshots').delete(item.key));
    await transactionDone(transaction);
    await deleteFromOpfs(workspaceId);
    this.revisions.delete(workspaceId);
    this.ephemeralAssets.delete(workspaceId);
  }

  async exportProject(workspaceId: string, operations: PatchOperation[]): Promise<void> {
    const record = await this.getRecord(workspaceId);
    const expected = this.revisions.get(workspaceId) ?? record.revision;
    if (record.revision !== expected) throw new Error('偵測到較新版本；為避免覆寫，請重新載入後再匯出。');
    record.currentHtml = applyWorkspaceDocument(record.editingBaseHtml, rewriteEphemeralAssets(operations, this.ephemeralAssets.get(workspaceId) ?? new Map()));
    record.revision += 1;
    record.updatedAt = new Date().toISOString();
    record.checksum = await sha256(record.currentHtml);
    await this.putWithSnapshot(record);
    this.revisions.set(workspaceId, record.revision);
    if (record.kind === 'html') return download(new Blob([record.currentHtml], { type: 'text/html;charset=utf-8' }), 'edited.html');
    const zip = new JSZip();
    zip.file(record.entry, record.currentHtml);
    Object.entries(record.assets).forEach(([path, bytes]) => zip.file(path, bytes));
    await download(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), 'edited-project.zip');
  }

  async printProject(workspaceId: string, operations: PatchOperation[]): Promise<void> {
    const updated = await this.saveDraft(workspaceId, operations);
    const html = updated.previewHtml?.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<style>@page{size:landscape;margin:0}@media print{html,body{margin:0!important;background:#fff!important}.slide,[data-slide]{display:block!important;visibility:visible!important;opacity:1!important;break-after:page;page-break-after:always}}</style>`);
    const url = URL.createObjectURL(new Blob([html ?? ''], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async diagnostics(): Promise<StorageDiagnostics> {
    const workspaces = await this.listWorkspaces();
    const estimate: StorageEstimate = await navigator.storage?.estimate?.().catch(() => ({})) ?? {};
    const persisted = await navigator.storage?.persisted?.().catch(() => null) ?? null;
    const opfsAvailable = Boolean(await opfsRoot());
    return {
      runtime: 'browser', backend: opfsAvailable ? 'indexeddb+opfs' : 'indexeddb-fallback', schemaVersion: BROWSER_SCHEMA_VERSION,
      persisted, opfsAvailable, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, workspaceCount: workspaces.length,
      warning: '工作區綁定此網站來源；清除網站資料、使用無痕模式或更換瀏覽器／裝置都可能移除資料。HTML／ZIP 匯出檔才是可攜式備份。',
    };
  }

  async requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    return navigator.storage.persist();
  }
}

export async function revalidateFileHandle(handle: FileSystemFileHandle, write = false): Promise<boolean> {
  const permissionHandle = handle as FileSystemFileHandle & {
    queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  };
  const permission = await permissionHandle.queryPermission({ mode: write ? 'readwrite' : 'read' });
  if (permission === 'granted') return true;
  return (await permissionHandle.requestPermission({ mode: write ? 'readwrite' : 'read' })) === 'granted';
}
