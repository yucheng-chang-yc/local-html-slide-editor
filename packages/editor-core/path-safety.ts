import path from 'node:path';

export function validateArchivePath(input: string): string {
  if (!input || input.includes('\0')) throw new Error('ZIP 內含無效路徑。');
  const unix = input.replaceAll('\\', '/');
  if (unix.startsWith('/') || /^[A-Za-z]:/.test(unix)) throw new Error(`拒絕絕對路徑：${input}`);
  const parts = unix.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) throw new Error(`拒絕路徑穿越：${input}`);
  const normalized = path.posix.normalize(parts.join('/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../')) throw new Error(`拒絕無效路徑：${input}`);
  return normalized;
}

export function safeJoin(root: string, relativePath: string): string {
  const normalized = validateArchivePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('路徑超出工作區。');
  }
  return resolved;
}
