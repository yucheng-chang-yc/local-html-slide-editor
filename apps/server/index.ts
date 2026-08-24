import { promises as fs } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { addAsset, applyWorkspacePatches, deleteWorkspace, editablePayload, exportWorkspace, getWorkspace, importPayload, latestWorkspace, listSnapshots, listWorkspaces, restoreOriginal, restoreSnapshot, saveWorkspacePatches } from './workspace.js';
import { safeJoin } from '../../packages/editor-core/path-safety.js';

const app = express();
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4174);
app.disable('x-powered-by');
app.use(express.json({ limit: '80mb' }));

app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.post('/api/import', async (request, response) => {
  try {
    const record = await importPayload(request.body);
    response.json(editablePayload(record));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '匯入失敗。' });
  }
});

app.get('/api/workspaces/:id/editable', (request, response) => {
  try { response.json(editablePayload(getWorkspace(request.params.id))); }
  catch (error) { response.status(404).json({ error: error instanceof Error ? error.message : '找不到工作區。' }); }
});

app.post('/api/workspaces/:id/draft', (request, response) => {
  void (async () => { try {
    const record = getWorkspace(request.params.id);
    const html = await saveWorkspacePatches(record, request.body.operations ?? []);
    response.json({ ok: true, html });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '無法套用修改。' });
  } })();
});

app.get('/api/session/last', (_request, response) => {
  const record = latestWorkspace();
  if (!record) return response.status(404).json({ error: '沒有可恢復的上次工作階段。' });
  response.json(editablePayload(record));
});

app.get('/api/workspaces', (_request, response) => response.json({ workspaces: listWorkspaces() }));

app.delete('/api/workspaces/:id', async (request, response) => {
  try { await deleteWorkspace(request.params.id); response.json({ ok: true }); }
  catch (error) { response.status(404).json({ error: error instanceof Error ? error.message : '找不到工作區。' }); }
});

app.get('/api/workspaces/:id/snapshots', async (request, response) => {
  try { response.json({ snapshots: await listSnapshots(getWorkspace(request.params.id)) }); }
  catch (error) { response.status(404).json({ error: error instanceof Error ? error.message : '找不到快照。' }); }
});

app.post('/api/workspaces/:id/restore/:snapshot', async (request, response) => {
  try {
    const record = getWorkspace(request.params.id);
    await restoreSnapshot(record, request.params.snapshot);
    response.json(editablePayload(record));
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : '無法還原快照。' }); }
});

app.post('/api/workspaces/:id/restore-original', async (request, response) => {
  try {
    const record = getWorkspace(request.params.id);
    await restoreOriginal(record);
    response.json(editablePayload(record));
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : '無法還原原始版本。' }); }
});

app.post('/api/workspaces/:id/assets', async (request, response) => {
  try {
    const src = await addAsset(getWorkspace(request.params.id), request.body.name, request.body.data);
    response.json({ src });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '無法加入圖片。' });
  }
});

app.post('/api/workspaces/:id/export', async (request, response) => {
  try {
    const record = getWorkspace(request.params.id);
    applyWorkspacePatches(record, request.body.operations ?? []);
    const exported = await exportWorkspace(record);
    response.setHeader('Content-Type', exported.type === 'zip' ? 'application/zip' : 'text/html; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${exported.name}"`);
    response.send(exported.buffer);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '匯出失敗。' });
  }
});

app.get('/api/workspaces/:id/files/*file', async (request, response) => {
  try {
    const record = getWorkspace(request.params.id);
    const fileParam = request.params.file;
    const relative = Array.isArray(fileParam) ? fileParam.join('/') : String(fileParam ?? '');
    if (relative === record.entry) return response.type('html').send(record.currentHtml);
    const absolute = safeJoin(record.root, relative);
    const content = await fs.readFile(absolute);
    response.type(path.extname(absolute)).send(content);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : '找不到檔案。' });
  }
});

app.get('/api/workspaces/:id/preview', (request, response) => {
  try {
    const record = getWorkspace(request.params.id);
    const base = `/api/workspaces/${record.id}/files/${path.posix.dirname(record.entry) === '.' ? '' : `${path.posix.dirname(record.entry)}/`}`;
    const printStyle = request.query.print === '1' ? '<style>@page{size:landscape;margin:0}@media print{html,body{margin:0!important;background:#fff!important}.slide,[data-slide]{display:block!important;visibility:visible!important;opacity:1!important;break-after:page;page-break-after:always}}</style>' : '';
    const html = record.currentHtml.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<base href="${base}">${printStyle}`);
    response.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'self'");
    response.type('html').send(html);
  } catch (error) {
    response.status(404).send(error instanceof Error ? error.message : '找不到預覽。');
  }
});

const clientDist = path.resolve('dist', 'client');
app.use(express.static(clientDist));
app.get('*path', async (_request, response) => {
  try {
    response.type('html').send(await fs.readFile(path.join(clientDist, 'index.html')));
  } catch {
    response.status(404).json({ error: '找不到頁面。' });
  }
});

const server = app.listen(port, host, () => console.log(`本地 HTML 簡報編輯器：http://${host}:${port}`));
const shutdown = () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
