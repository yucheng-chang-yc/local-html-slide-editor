import { BrowserWorkspaceAdapter } from './browser-workspace';
import { NodeWorkspaceAdapter } from './node-workspace';
import type { PatchOperation } from '../../../packages/editor-core/types';
import type { StorageDiagnostics, WorkspacePayload, WorkspaceSnapshot, WorkspaceSummary } from '../../../packages/workspace/types';

export type { StorageDiagnostics, WorkspacePayload, WorkspaceSnapshot, WorkspaceSummary } from '../../../packages/workspace/types';

export const runtimeMode = import.meta.env.MODE === 'browser' ? 'browser' : 'node';
export const workspaceAdapter = runtimeMode === 'browser' ? new BrowserWorkspaceAdapter() : new NodeWorkspaceAdapter();

export const importFile = (file: File): Promise<WorkspacePayload> => workspaceAdapter.importFile(file);
export const uploadAsset = (workspaceId: string, file: File): Promise<string> => workspaceAdapter.uploadAsset(workspaceId, file);
export const saveDraft = (workspaceId: string, operations: PatchOperation[]): Promise<WorkspacePayload | null> => workspaceAdapter.saveDraft(workspaceId, operations);
export const loadLastSession = (): Promise<WorkspacePayload | null> => workspaceAdapter.loadLastSession();
export const listWorkspaces = (): Promise<WorkspaceSummary[]> => workspaceAdapter.listWorkspaces();
export const listSnapshots = (workspaceId: string): Promise<WorkspaceSnapshot[]> => workspaceAdapter.listSnapshots(workspaceId);
export const restoreWorkspace = (workspaceId: string, snapshot?: string): Promise<WorkspacePayload> => workspaceAdapter.restoreWorkspace(workspaceId, snapshot);
export const deleteWorkspace = (workspaceId: string): Promise<void> => workspaceAdapter.deleteWorkspace(workspaceId);
export const exportProject = (workspaceId: string, operations: PatchOperation[]): Promise<void> => workspaceAdapter.exportProject(workspaceId, operations);
export const printProject = (workspaceId: string, operations: PatchOperation[]): Promise<void> => workspaceAdapter.printProject(workspaceId, operations);
export const getStorageDiagnostics = (): Promise<StorageDiagnostics> => workspaceAdapter.diagnostics();
export const requestPersistentStorage = (): Promise<boolean> => workspaceAdapter.requestPersistence();
