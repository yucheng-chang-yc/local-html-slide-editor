import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('20 頁 200 物件互動與匯出效能基準', async ({ page }) => {
  const slides = Array.from({ length: 20 }, (_, slide) => `<section class="slide" style="display:${slide ? 'none' : 'block'};position:relative;width:1600px;height:900px">${Array.from({ length: 10 }, (_, object) => `<div style="position:absolute;left:${40 + object * 120}px;top:${70 + object * 55}px;width:100px;height:44px">S${slide + 1}-O${object + 1}</div>`).join('')}</section>`).join('');
  const html = `<!doctype html><html lang="zh-Hant-TW"><head><title>效能基準</title></head><body><main>${slides}</main></body></html>`;
  await page.goto('/');
  const loadStart = performance.now();
  await page.locator('input[type=file]').nth(0).setInputFiles({ name: 'performance.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  const frame = page.frameLocator('iframe[title="簡報編輯畫布"]');
  await expect(page.getByRole('complementary', { name: '投影片縮圖' }).getByRole('button', { name: /^編輯第 / })).toHaveCount(20);
  const loadMs = performance.now() - loadStart;
  const target = frame.getByText('S1-O1', { exact: true }); await target.click();
  const interactionStart = performance.now();
  for (let index = 0; index < 20; index += 1) await page.keyboard.press('ArrowRight');
  const interactionMs = performance.now() - interactionStart;
  const exportStart = performance.now();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '匯出' }).click(); await download;
  const exportMs = performance.now() - exportStart;
  const metrics = { generatedAt: new Date().toISOString(), slides: 20, objects: 200, loadMs, twentyNudgesMs: interactionMs, exportMs, thresholds: { loadMs: 5000, twentyNudgesMs: 3000, exportMs: 5000 }, pass: loadMs < 5000 && interactionMs < 3000 && exportMs < 5000 };
  await fs.mkdir(path.resolve('evidence', 'performance'), { recursive: true });
  await fs.writeFile(path.resolve('evidence', 'performance', 'benchmark.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  expect(metrics.pass).toBe(true);
});
