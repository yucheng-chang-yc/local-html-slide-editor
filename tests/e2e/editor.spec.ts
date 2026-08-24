import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import * as parse5 from 'parse5';
import { createHash } from 'node:crypto';

const screenshots = path.resolve('evidence', 'screenshots');

async function projectZip(fixture: 'supported_fixed_canvas' | 'boundary_flow_layout'): Promise<Buffer> {
  const root = path.resolve('fixtures', fixture);
  const zip = new JSZip();
  const walk = async (directory: string): Promise<void> => {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await walk(absolute);
      else zip.file(path.relative(root, absolute).split(path.sep).join('/'), await fs.readFile(absolute));
    }
  };
  await walk(root);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test.beforeAll(async () => { await fs.mkdir(screenshots, { recursive: true }); });

test('完整視覺編輯、歷史、預覽、匯出與重開流程', async ({ page }) => {
  await page.goto('/');
  for (const label of ['開啟檔案','匯入 ZIP','文字方塊','圖片','矩形','復原','重做','預覽','匯出']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  const fileInputs = page.locator('input[type=file]');
  await expect(fileInputs).toHaveCount(2);
  await fileInputs.nth(0).setInputFiles({ name: 'supported.zip', mimeType: 'application/zip', buffer: await projectZip('supported_fixed_canvas') });
  const frame = page.frameLocator('iframe[title="簡報編輯畫布"]');
  await expect(frame.locator('#title-1')).toHaveText('本地 HTML 簡報編輯器');
  await expect(frame.locator('html')).not.toHaveAttribute('data-navigation-executed', 'true');
  await page.locator('details.inspector-advanced summary').click();
  await page.getByRole('button', { name: '格線', exact: true }).click();
  const unchangedBefore = await frame.locator('#subtitle-1').evaluate((element) => {
    const target = element as HTMLElement;
    return { x: target.offsetLeft, y: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight };
  });

  const title = frame.locator('#title-1');
  const start = await title.boundingBox(); expect(start).not.toBeNull();
  await title.hover(); await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2 + 42, start!.y + start!.height / 2 + 32);
  await expect(frame.locator('.editor-alignment-grid')).toHaveCount(1);
  await page.mouse.up();
  await expect(frame.locator('.editor-alignment-grid')).toHaveCount(1);
  const moved = await title.boundingBox();
  expect(Math.abs((moved!.x - start!.x) - 42)).toBeLessThanOrEqual(6);
  expect(Math.abs((moved!.y - start!.y) - 32)).toBeLessThanOrEqual(6);
  await page.getByRole('button', { name: '復原' }).click();
  const dragUndone = await title.boundingBox(); expect(Math.abs(dragUndone!.x - start!.x)).toBeLessThanOrEqual(6);
  await page.getByRole('button', { name: '重做' }).click();
  const dragRedone = await title.boundingBox(); expect(Math.abs(dragRedone!.x - moved!.x)).toBeLessThanOrEqual(6);

  await title.click();
  const handle = frame.locator('.editor-resize-handle');
  await expect(handle).toHaveCount(1);
  const sizeBefore = await title.boundingBox();
  await handle.hover();
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2); await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 60, handleBox!.y + handleBox!.height / 2 + 30); await page.mouse.up();
  const resized = await title.boundingBox();
  expect(Math.abs((resized!.width - sizeBefore!.width) - 60)).toBeLessThanOrEqual(2);
  expect(Math.abs((resized!.height - sizeBefore!.height) - 30)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '復原' }).click();
  const resizeUndone = await title.boundingBox(); expect(Math.abs(resizeUndone!.width - sizeBefore!.width)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '重做' }).click();
  const resizeRedone = await title.boundingBox(); expect(Math.abs(resizeRedone!.width - resized!.width)).toBeLessThanOrEqual(1);

  await title.dblclick(); await title.evaluate((element) => { element.textContent = '視覺編輯完成'; (element as HTMLElement).blur(); });
  await expect(title).toHaveText('視覺編輯完成');
  await page.getByRole('button', { name: '復原' }).click(); await expect(title).toHaveText('本地 HTML 簡報編輯器');
  await page.getByRole('button', { name: '重做' }).click(); await expect(title).toHaveText('視覺編輯完成');
  await title.click();
  const nudgeBefore = await title.boundingBox(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  const nudgeAfter = await title.boundingBox();
  expect(Math.round(nudgeAfter!.x - nudgeBefore!.x)).toBe(1); expect(Math.round(nudgeAfter!.y - nudgeBefore!.y)).toBe(10);

  await page.getByRole('button', { name: '插入', exact: true }).click();
  await page.getByRole('button', { name: '文字方塊', exact: true }).click();
  await expect(frame.getByText('雙擊編輯文字')).toBeVisible();
  await page.getByRole('button', { name: '復原' }).click(); await expect(frame.getByText('雙擊編輯文字')).toHaveCount(0);
  await page.getByRole('button', { name: '重做' }).click(); await expect(frame.getByText('雙擊編輯文字')).toBeVisible();
  await page.locator('details.shape-menu summary').click();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await fileInputs.nth(1).setInputFiles({ name: 'inserted.svg', mimeType: 'image/svg+xml', buffer: await fs.readFile(path.resolve('fixtures/supported_fixed_canvas/assets/sample.svg')) });
  await expect(frame.locator('[data-editor-new]')).toHaveCount(4);

  await page.getByRole('button', { name: '常用', exact: true }).click();
  await page.getByRole('button', { name: '複製', exact: true }).click();
  await expect(frame.locator('[data-editor-new]')).toHaveCount(4);
  await page.getByRole('button', { name: '貼上' }).click();
  await expect(frame.locator('[data-editor-new]')).toHaveCount(5);
  const selected = frame.locator('.editor-selected'); await expect(selected).toHaveCount(1);
  await expect(page.getByRole('button', { name: '上移一層' })).toBeDisabled();
  await page.getByRole('button', { name: '下移一層' }).click();
  expect(Number(await selected.evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(0);
  await page.getByRole('button', { name: '上移一層' }).click();
  await page.getByRole('button', { name: '刪除' }).click();
  await expect(frame.locator('[data-editor-new]')).toHaveCount(4);
  await page.getByRole('button', { name: '復原' }).click(); await expect(frame.locator('[data-editor-new]')).toHaveCount(5);
  await page.getByRole('button', { name: '重做' }).click(); await expect(frame.locator('[data-editor-new]')).toHaveCount(4);
  await page.screenshot({ path: path.join(screenshots, '01-edited-workflow.png'), fullPage: true });

  const expectedGeometry = await title.evaluate((element) => {
    const rect = element.getBoundingClientRect(); const parent = element.parentElement!.getBoundingClientRect();
    return { x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height };
  });
  await page.getByRole('button', { name: '預覽' }).click();
  const preview = page.frameLocator('iframe[title="簡報執行預覽"]');
  await expect(preview.locator('#counter')).toHaveText('1 / 2'); await preview.locator('#next').click();
  await expect(preview.locator('#counter')).toHaveText('2 / 2');
  await page.screenshot({ path: path.join(screenshots, '02-execution-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '返回編輯' }).click();

  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '匯出' }).click();
  const download = await downloadPromise; const exportedPath = await download.path();
  const zipBuffer = await fs.readFile(exportedPath!); const zip = await JSZip.loadAsync(zipBuffer);
  const html = await zip.file('index.html')!.async('string');
  expect(html).toContain('視覺編輯完成'); expect(html).toContain('雙擊編輯文字');
  expect(Object.keys(zip.files).some((name) => name.startsWith('assets/user-'))).toBe(true);
  expect(await zip.file('script.js')!.async('string')).toBe(await fs.readFile(path.resolve('fixtures/supported_fixed_canvas/script.js'), 'utf8'));
  const diffDir = path.resolve('evidence', 'diffs'); await fs.mkdir(diffDir, { recursive: true });
  const originalHtml = await fs.readFile(path.resolve('fixtures/supported_fixed_canvas/index.html'), 'utf8');
  const commonPrefix = (a: string, b: string) => { let index = 0; while (index < a.length && index < b.length && a[index] === b[index]) index += 1; return index; };
  const commonSuffix = (a: string, b: string, prefix: number) => { let index = 0; while (index < a.length - prefix && index < b.length - prefix && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1; return index; };
  const prefix = commonPrefix(originalHtml, html); const suffix = commonSuffix(originalHtml, html, prefix);
  const serialized = parse5.serialize(parse5.parse(originalHtml));
  const serializedPrefix = commonPrefix(originalHtml, serialized); const serializedSuffix = commonSuffix(originalHtml, serialized, serializedPrefix);
  const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
  await fs.writeFile(path.join(diffDir, 'original.html'), originalHtml);
  await fs.writeFile(path.join(diffDir, 'exported.html'), html);
  await fs.writeFile(path.join(diffDir, 'diff-metrics.json'), JSON.stringify({
    sourceBytes: Buffer.byteLength(originalHtml), exportedBytes: Buffer.byteLength(html),
    sourcePreservingChangedWindowBytes: html.length - prefix - suffix,
    fullSerializationChangedWindowBytes: serialized.length - serializedPrefix - serializedSuffix,
    untouchedScriptSha256Before: sha256(await fs.readFile(path.resolve('fixtures/supported_fixed_canvas/script.js'))),
    untouchedScriptSha256After: sha256(await zip.file('script.js')!.async('nodebuffer')),
    untouchedAssetSha256Before: sha256(await fs.readFile(path.resolve('fixtures/supported_fixed_canvas/assets/sample.svg'))),
    untouchedAssetSha256After: sha256(await zip.file('assets/sample.svg')!.async('nodebuffer')),
  }, null, 2));
  await fs.writeFile(path.join(diffDir, 'geometry.json'), JSON.stringify({ expectedGeometry, unchangedBefore }, null, 2));

  await fileInputs.nth(0).setInputFiles({ name: 'reopened.zip', mimeType: 'application/zip', buffer: zipBuffer });
  await expect(frame.locator('#title-1')).toHaveText('視覺編輯完成');
  const reopenedGeometry = await frame.locator('#title-1').evaluate((element) => {
    const rect = element.getBoundingClientRect(); const parent = element.parentElement!.getBoundingClientRect();
    return { x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height };
  });
  for (const key of ['x','y','width','height'] as const) expect(Math.abs(reopenedGeometry[key] - expectedGeometry[key])).toBeLessThanOrEqual(1);
  await expect(frame.locator('img[alt="inserted.svg"]')).toBeVisible();
  await expect(frame.getByText('雙擊編輯文字')).toBeVisible();
  await expect(frame.locator('div[data-editor-kind="rectangle"]')).toHaveCount(1);
  await expect.poll(async () => {
    try {
      return await frame.locator('#subtitle-1').evaluate((element, before) => {
        const target = element as HTMLElement;
        return Math.abs(target.offsetLeft - before.x) <= 1 && Math.abs(target.offsetTop - before.y) <= 1
          && Math.abs(target.offsetWidth - before.width) <= 1 && Math.abs(target.offsetHeight - before.height) <= 1;
      }, unchangedBefore);
    } catch {
      // Reopened ZIPs replace the iframe document; retry while that navigation settles.
      return false;
    }
  }).toBe(true);
  const unchangedAfter = await frame.locator('#subtitle-1').evaluate((element) => {
    const target = element as HTMLElement;
    return { x: target.offsetLeft, y: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight };
  });
  for (const key of ['x','y','width','height'] as const) expect(Math.abs(unchangedAfter[key] - unchangedBefore[key])).toBeLessThanOrEqual(1);
  await fs.writeFile(path.join(diffDir, 'geometry.json'), JSON.stringify({ expectedGeometry, reopenedGeometry, unchangedBefore, unchangedAfter }, null, 2));
  await page.screenshot({ path: path.join(screenshots, '03-reopened-export.png'), fullPage: true });
});

test('單一 HTML 匯入與編輯 sandbox 阻止 parent DOM 控制', async ({ page }) => {
  await page.goto('/');
  const html = `<!doctype html><html lang="zh-Hant-TW"><head><title>安全測試</title></head><body><section class="slide"><h1>單一 HTML</h1></section><script>try{parent.document.body.dataset.compromised='yes'}catch(e){document.body.dataset.isolated='true'}</script></body></html>`;
  await page.locator('input[type=file]').nth(0).setInputFiles({ name: 'single.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('單一 HTML')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-compromised', 'yes');
});

test('真正 canvas-only 文件才整頁唯讀並顯示精確原因', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').nth(0).setInputFiles({ name: 'unsafe.html', mimeType: 'text/html', buffer: await fs.readFile(path.resolve('fixtures/truly_unsafe_canvas/index.html')) });
  await expect(page.getByRole('status')).toContainText('canvas-only rendering');
  await expect(page.getByRole('button', { name: '文字方塊', exact: true })).toBeDisabled();
  await expect(page.locator('.contextual-command-bar')).toHaveAttribute('data-command-context', 'slide');
  await expect(page.getByRole('button', { name: '刪除' })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, '04-truly-unsafe-read-only.png'), fullPage: true });
});
