export type CommandId = 'copy' | 'paste' | 'duplicate' | 'delete' | 'bring-forward' | 'send-backward' | 'undo' | 'redo' | 'group' | 'ungroup';

export interface CommandDefinition {
  id: CommandId;
  label: string;
  shortcut?: string;
  group: 'clipboard' | 'arrange' | 'history';
}

export const commandRegistry: Record<CommandId, CommandDefinition> = {
  copy: { id: 'copy', label: '複製', shortcut: 'Ctrl+C', group: 'clipboard' },
  paste: { id: 'paste', label: '貼上', shortcut: 'Ctrl+V', group: 'clipboard' },
  duplicate: { id: 'duplicate', label: '建立副本', shortcut: 'Ctrl+D', group: 'clipboard' },
  delete: { id: 'delete', label: '刪除', shortcut: 'Delete', group: 'clipboard' },
  'bring-forward': { id: 'bring-forward', label: '上移一層', group: 'arrange' },
  'send-backward': { id: 'send-backward', label: '下移一層', group: 'arrange' },
  undo: { id: 'undo', label: '復原', shortcut: 'Ctrl+Z', group: 'history' },
  redo: { id: 'redo', label: '重做', shortcut: 'Ctrl+Y', group: 'history' },
  group: { id: 'group', label: '群組', shortcut: 'Ctrl+G', group: 'arrange' },
  ungroup: { id: 'ungroup', label: '取消群組', shortcut: 'Ctrl+Shift+G', group: 'arrange' },
};
