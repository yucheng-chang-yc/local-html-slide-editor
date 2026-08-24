import type { PatchOperation } from '../../../packages/editor-core/types';
import type { StorageDiagnostics, WorkspaceAdapter, WorkspacePayload, WorkspaceSnapshot, WorkspaceSummary } from '../../../packages/workspace/types';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '操作失敗。');
  return body;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export class NodeWorkspaceAdapter implements WorkspaceAdapter {
  readonly runtime = 'node' as const;

  async importFile(file: File): Promise<WorkspacePayload> {
    return json(await fetch('/api/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, kind: file.name.toLowerCase().endsWith('.zip') ? 'zip' : 'html', data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }),
    }));
  }

  async uploadAsset(workspaceId: string, file: File): Promise<string> {
    const result = await json<{ src: string }>(await fetch(`/api/workspaces/${workspaceId}/assets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }),
    }));
    return result.src;
  }

  async saveDraft(workspaceId: string, operations: PatchOperation[]): Promise<null> {
    await json(await fetch(`/api/workspaces/${workspaceId}/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }),
    }));
    return null;
  }

  async loadLastSession(): Promise<WorkspacePayload | null> {
    const response = await fetch('/api/session/last');
    if (response.status === 404) return null;
    return json(response);
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return (await json<{ workspaces: WorkspaceSummary[] }>(await fetch('/api/workspaces'))).workspaces;
  }

  async listSnapshots(workspaceId: string): Promise<WorkspaceSnapshot[]> {
    return (await json<{ snapshots: WorkspaceSnapshot[] }>(await fetch(`/api/workspaces/${workspaceId}/snapshots`))).snapshots;
  }

  async restoreWorkspace(workspaceId: string, snapshot?: string): Promise<WorkspacePayload> {
    const endpoint = snapshot ? `/api/workspaces/${workspaceId}/restore/${encodeURIComponent(snapshot)}` : `/api/workspaces/${workspaceId}/restore-original`;
    return json(await fetch(endpoint, { method: 'POST' }));
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await json(await fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' }));
  }

  async exportProject(workspaceId: string, operations: PatchOperation[]): Promise<void> {
    const response = await fetch(`/api/workspaces/${workspaceId}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? '匯出失敗。');
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'edited-project.zip';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async printProject(workspaceId: string, operations: PatchOperation[]): Promise<void> {
    await this.saveDraft(workspaceId, operations);
    window.open(`/api/workspaces/${workspaceId}/preview?print=1`, '_blank', 'noopener');
  }

  async diagnostics(): Promise<StorageDiagnostics> {
    const workspaces = await this.listWorkspaces();
    return { runtime: 'node', backend: 'node-filesystem', schemaVersion: 1, persisted: true, opfsAvailable: false, usage: null, quota: null, workspaceCount: workspaces.length };
  }

  async requestPersistence(): Promise<boolean> { return true; }
}
