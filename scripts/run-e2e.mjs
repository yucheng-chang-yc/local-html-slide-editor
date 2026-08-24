import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const port = 4187;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist/server/apps/server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit'],
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(origin);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) throw new Error('E2E test server did not start before the timeout.');

  const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_EXTERNAL_SERVER: '1' },
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (server.exitCode === null) server.kill('SIGKILL');
}
