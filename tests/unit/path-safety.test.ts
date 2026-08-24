import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeJoin, validateArchivePath } from '../../packages/editor-core/path-safety';

describe('workspace path safety', () => {
  it.each(['../escape.txt', 'folder/../../escape.txt', '/absolute.txt', 'C:/escape.txt', '..\\escape.txt'])(
    'rejects unsafe archive path %s', (candidate) => expect(() => validateArchivePath(candidate)).toThrow(),
  );

  it('keeps normal paths inside the workspace', () => {
    const root = path.resolve('.data', 'test-root');
    expect(safeJoin(root, 'assets/image.png').startsWith(root)).toBe(true);
  });
});
