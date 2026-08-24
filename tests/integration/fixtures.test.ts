import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { applyWorkspacePatches, classifyCompatibility, editablePayload, exportWorkspace, importPayload } from '../../apps/server/workspace';
import { inspectHtml } from '../../packages/editor-core/html-patch';

const fixtureRoot = path.resolve('fixtures', 'supported_fixed_canvas');
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function fixtureZip(): Promise<Buffer> {
  const zip = new JSZip();
  const add = async (relative: string) => zip.file(relative, await fs.readFile(path.join(fixtureRoot, relative)));
  await Promise.all(['index.html', 'styles.css', 'script.js', 'assets/sample.svg'].map(add));
  return zip.generateAsync({ type: 'nodebuffer' });
}

afterAll(async () => { await fs.rm(path.resolve('.data'), { recursive: true, force: true }); });

describe('fixture import, patch, export and reopen', () => {
  it('round-trips the supported ZIP while preserving script and asset bytes', async () => {
    const sourceZip = await fixtureZip();
    const record = await importPayload({ name: 'fixture.zip', kind: 'zip', data: sourceZip.toString('base64') });
    const editable = editablePayload(record);
    expect(editable.compatibility.level).toBe('SUPPORTED');
    const title = inspectHtml(record.sourceHtml).elements.find((item) => item.attributes.id === 'title-1')!;
    const scriptBefore = await fs.readFile(path.join(fixtureRoot, 'script.js'));
    const assetBefore = await fs.readFile(path.join(fixtureRoot, 'assets', 'sample.svg'));
    applyWorkspacePatches(record, [
      { type: 'setStyle', id: title.id, value: 'position:absolute;left:120px;top:140px;width:760px;height:70px' },
      { type: 'replaceText', id: title.id, value: '已重新匯入的標題' },
    ]);
    const exported = await exportWorkspace(record);
    const reopened = await JSZip.loadAsync(exported.buffer);
    expect(await reopened.file('index.html')!.async('string')).toContain('已重新匯入的標題');
    expect(hash(await reopened.file('script.js')!.async('nodebuffer'))).toBe(hash(scriptBefore));
    expect(hash(await reopened.file('assets/sample.svg')!.async('nodebuffer'))).toBe(hash(assetBefore));
    const second = await importPayload({ name: 'reopen.zip', kind: 'zip', data: exported.buffer.toString('base64') });
    expect(second.sourceHtml).toContain('left:120px');
  });

  it('rejects path traversal archives without writing payloads', async () => {
    const zip = new JSZip(); zip.file('../outside.txt', 'no'); zip.file('index.html', '<html></html>');
    await expect(importPayload({ name: 'bad.zip', kind: 'zip', data: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') })).rejects.toThrow(/路徑|ZIP/);
    await expect(fs.access(path.resolve('.data', 'outside.txt'))).rejects.toBeTruthy();
  });

  it('keeps ordinary responsive flow, flex and grid documents editable', async () => {
    const html = await fs.readFile(path.resolve('fixtures', 'responsive_flex_grid', 'index.html'), 'utf8');
    const css = await fs.readFile(path.resolve('fixtures', 'responsive_flex_grid', 'styles.css'), 'utf8');
    const report = classifyCompatibility(`${html}<style>${css}</style>`);
    expect(report.level).toBe('SUPPORTED');
    expect(report.documentReadOnly).toBe(false);
    expect(report.restrictedElements).toHaveLength(0);
    expect(report.reasons.join(' ')).toMatch(/flow|flex|grid|responsive/);
  });

  it('keeps a script-initialized static slide deck editable', async () => {
    const html = await fs.readFile(path.resolve('fixtures', 'script_initialized_deck', 'index.html'), 'utf8');
    const report = classifyCompatibility(html);
    expect(report.level).toBe('SUPPORTED');
    expect(report.documentReadOnly).toBe(false);
  });

  it('limits only the nested-transform subtree', async () => {
    const html = await fs.readFile(path.resolve('fixtures', 'mixed_nested_transform', 'index.html'), 'utf8');
    const report = classifyCompatibility(html);
    const elements = inspectHtml(html).elements;
    const risk = elements.find((item) => item.attributes.id === 'risk-text')!;
    const safe = elements.find((item) => item.attributes.id === 'safe-text')!;
    expect(report.level).toBe('MIXED');
    expect(report.documentReadOnly).toBe(false);
    expect(report.restrictedElements.some((item) => item.id === risk.id)).toBe(true);
    expect(report.restrictedElements.some((item) => item.id === safe.id)).toBe(false);
  });

  it('uses whole-document read-only only for a proven canvas-only document', async () => {
    const html = await fs.readFile(path.resolve('fixtures', 'truly_unsafe_canvas', 'index.html'), 'utf8');
    const report = classifyCompatibility(html);
    expect(report.level).toBe('READ_ONLY');
    expect(report.documentReadOnly).toBe(true);
    expect(report.reasons.join(' ')).toMatch(/canvas-only/);
  });
});
