import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const logDirectory = path.resolve('evidence', 'logs');
const resultDirectory = path.resolve('evidence', 'test-results');
await mkdir(logDirectory, { recursive: true });
await mkdir(resultDirectory, { recursive: true });

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('請透過 pnpm run verify:all 執行完整驗證。');

const commands = [
  ['install', ['install', '--frozen-lockfile']],
  ['lint', ['run', 'lint']],
  ['typecheck', ['run', 'typecheck']],
  ['test', ['run', 'test']],
  ['build', ['run', 'build']],
  ['test-e2e', ['run', 'test:e2e']],
  ['verify-fixtures', ['run', 'verify:fixtures']],
  ['verify-language', ['run', 'verify:language']],
  ['verify-licenses', ['run', 'verify:licenses']],
];

const results = [];
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 30 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  await writeFile(path.join(logDirectory, `final-${name}.log`), output, 'utf8');
  results.push({
    name,
    command: `pnpm ${args.join(' ')}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.status ?? 1,
  });
  process.stdout.write(output);
  await writeFile(path.join(resultDirectory, 'verification-results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Fresh verification PASS：${results.length} 個命令全部 exit 0。`);
