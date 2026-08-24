import type { CompatibilityReport, PatchOperation } from '../editor-core/types';

export type WorkspaceKind = 'html' | 'zip';
export type WorkspaceRuntime = 'node' | 'browser';

export interface WorkspacePayload {
  id: string;
  entry: string;
  html: string;
  previewHtml?: string;
  elements: Array<{ id: string; tagName: string; directText: string; attributes: Record<string, string> }>;
  speakerNotes: string[] | null;
  compatibility: CompatibilityReport;
  revision?: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  entry: string;
  kind: WorkspaceKind;
  importedAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkspaceSnapshot {
  id: string;
  createdAt: string;
  revision?: number;
}

export interface StorageDiagnostics {
  runtime: WorkspaceRuntime;
  backend: 'node-filesystem' | 'indexeddb+opfs' | 'indexeddb-fallback';
  schemaVersion: number;
  persisted: boolean | null;
  opfsAvailable: boolean;
  usage: number | null;
  quota: number | null;
  workspaceCount: number;
  warning?: string;
}

export interface WorkspaceAdapter {
  readonly runtime: WorkspaceRuntime;
  importFile(file: File): Promise<WorkspacePayload>;
  uploadAsset(workspaceId: string, file: File): Promise<string>;
  saveDraft(workspaceId: string, operations: PatchOperation[]): Promise<WorkspacePayload | null>;
  loadLastSession(): Promise<WorkspacePayload | null>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listSnapshots(workspaceId: string): Promise<WorkspaceSnapshot[]>;
  restoreWorkspace(workspaceId: string, snapshot?: string): Promise<WorkspacePayload>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  exportProject(workspaceId: string, operations: PatchOperation[]): Promise<void>;
  printProject(workspaceId: string, operations: PatchOperation[]): Promise<void>;
  diagnostics(): Promise<StorageDiagnostics>;
  requestPersistence(): Promise<boolean>;
}
