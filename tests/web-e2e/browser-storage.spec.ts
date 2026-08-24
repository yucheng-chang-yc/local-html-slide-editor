import { promises as fs } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

const basicHtml = (title = '瀏覽器工作區') => `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>${title}</title><style>.slide{position:relative;width:1600px;height:900px}.title{position:absolute;left:100px;top:100px;font-size:64px}</style></head><body><main><section class="slide"><h1 class="title">${title}</h1></section></main><script>try{parent.document.body.dataset.compromised='yes'}catch(e){document.body.dataset.isolated='true'}</script></body></html>`;

async function importHtml(page: Page, html = basicHtml(), name = 'browser.html'): Promise<void> {
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name, mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('h1')).toBeVisible();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('.editor-interaction-layer')).toHaveCount(1);
}

async function editTitle(page: Page, text: string): Promise<void> {
  const title = page.frameLocator('iframe[title="簡報編輯畫布"]').locator('h1');
  await title.dblclick();
  await title.fill(text);
  await title.press('Tab');
  await expect.poll(() => page.evaluate(async (expected) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const records = request.result.transaction('workspaces', 'readonly').objectStore('workspaces').getAll();
      records.onsuccess = () => resolve(records.result.some((record) => record.revision > 1 && record.currentHtml.includes(expected)));
      records.onerror = () => reject(records.error);
    };
    request.onerror = () => reject(request.error);
  }), text), { timeout: 10_000 }).toBe(true);
  await expect(page.getByText('已儲存', { exact: true })).toBeVisible();
}

async function openBrowserStorage(page: Page): Promise<void> {
  await page.locator('.global-overflow > summary').click();
  await page.getByRole('button', { name: '瀏覽器儲存', exact: true }).click();
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === 'schema v1 upgrades deterministically to the current browser schema') return;
  await page.goto('/');
  await expect(page.getByText('瀏覽器本機工作區 · 尚未開啟簡報')).toBeVisible();
});

test('backend-free static mode imports, edits, autosaves, reloads, and makes no API request', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await importHtml(page);
  expect(await page.evaluate(() => document.body.dataset.compromised)).toBeUndefined();
  await editTitle(page, '重載後仍存在');
  await page.reload();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('重載後仍存在')).toBeVisible();
  expect(apiRequests).toEqual([]);
  const databaseVersion = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => { resolve(request.result.version); request.result.close(); };
    request.onerror = () => reject(request.error);
  }));
  expect(databaseVersion).toBe(3);
});

test('schema v1 upgrades deterministically to the current browser schema', async ({ page }) => {
  await page.route('**/', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><body>schema fixture</body></html>',
  }), { times: 1 });
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('local-html-slide-editor', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'id' });
      request.onsuccess = async () => {
        const html = '<!doctype html><html><body><section class="slide"><h1>Schema v1 preserved</h1><img src="assets/pixel.svg"></section><script type="application/json" data-editor-speaker-notes>["preserved note"]</script></body></html>';
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
        const checksum = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
        const transaction = request.result.transaction('workspaces', 'readwrite');
        transaction.objectStore('workspaces').put({
          id: 'schema-v1-workspace', name: 'schema-v1.zip', entry: 'index.html', kind: 'zip',
          importedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 7,
          sourceHtml: html, currentHtml: html, editingBaseHtml: html, checksum,
          assets: { 'assets/pixel.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').buffer },
          storageBackend: 'indexeddb-fallback',
        });
        transaction.oncomplete = () => { request.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.unroute('**/');
  await page.goto('/');
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('Schema v1 preserved')).toBeVisible();
  const schema = await page.evaluate(async () => new Promise<{ version: number; stores: string[]; revision: number; assetNames: string[]; html: string }>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const database = request.result;
      const record = database.transaction('workspaces', 'readonly').objectStore('workspaces').get('schema-v1-workspace');
      record.onsuccess = () => {
        resolve({
          version: database.version,
          stores: [...database.objectStoreNames],
          revision: record.result.revision,
          assetNames: Object.keys(record.result.assets),
          html: record.result.currentHtml,
        });
        database.close();
      };
      record.onerror = () => reject(record.error);
    };
    request.onerror = () => reject(request.error);
  }));
  expect(schema).toEqual({
    version: 3,
    stores: ['meta', 'snapshots', 'workspaces'],
    revision: 7,
    assetNames: ['assets/pixel.svg'],
    html: expect.stringContaining('preserved note'),
  });
});

test('active browser database connection yields to a later schema versionchange', async ({ page }) => {
  const upgradedVersion = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor', 4);
    request.onsuccess = () => {
      resolve(request.result.version);
      request.result.close();
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('active editor connection blocked versionchange'));
  }));
  expect(upgradedVersion).toBe(4);
});

test('accepted nine-page deck imports and restores in browser mode', async ({ page }) => {
  const source = await fs.readFile('fixtures/golden_actual_deck/index.html');
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'actual-deck.html', mimeType: 'text/html', buffer: source });
  await expect(page.getByRole('complementary').locator('iframe')).toHaveCount(9);
  await page.reload();
  await expect(page.getByRole('complementary').locator('iframe')).toHaveCount(9);
});

test('blank presentation remains editable and recoverable in browser mode', async ({ page }) => {
  const blank = '<!doctype html><html><head><style>.slide{position:relative;width:1600px;height:900px}</style></head><body><main><section class="slide"></section></main></body></html>';
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'blank.html', mimeType: 'text/html', buffer: Buffer.from(blank) });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('.editor-interaction-layer')).toHaveCount(1);
  await page.reload();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('.slide')).toHaveCount(1);
});

test('storage diagnostics, persistence result, warning, and deletion cleanup are actionable', async ({ page }) => {
  await importHtml(page);
  await openBrowserStorage(page);
  const panel = page.getByRole('region', { name: '瀏覽器儲存狀態' });
  await expect(panel).toContainText('清除網站資料會刪除工作區');
  await expect(panel).toContainText('HTML／ZIP 匯出檔才是可攜式備份');
  await panel.getByRole('button', { name: '要求持久儲存' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: '刪除目前工作區' }).click();
  await expect(page.getByText('開啟你的簡報')).toBeVisible();
  expect(await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const transaction = request.result.transaction('workspaces', 'readonly');
      const count = transaction.objectStore('workspaces').count();
      count.onsuccess = () => resolve(count.result); count.onerror = () => reject(count.error);
    };
  }))).toBe(0);
});

test('checksum corruption is detected and recovery guidance is shown', async ({ page }) => {
  await importHtml(page, basicHtml('Checksum 測試'));
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const transaction = request.result.transaction('workspaces', 'readwrite');
      const store = transaction.objectStore('workspaces');
      const all = store.getAll();
      all.onsuccess = () => store.put({ ...all.result[0], currentHtml: '<html>corrupted</html>' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await page.reload();
  await expect(page.getByRole('status')).toContainText(/校驗失敗|重新匯入|備份/);
});

test('snapshot retention is bounded to ten recent revisions', async ({ page }) => {
  await importHtml(page, basicHtml('Snapshot 測試'));
  const workspaceId = await page.evaluate(async () => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const all = request.result.transaction('workspaces', 'readonly').objectStore('workspaces').getAll();
      all.onsuccess = () => resolve(all.result[0].id);
      all.onerror = () => reject(all.error);
    };
    request.onerror = () => reject(request.error);
  }));
  for (let revision = 0; revision < 12; revision += 1) await editTitle(page, `Snapshot ${revision}`);
  const count = await page.evaluate(async (id) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('local-html-slide-editor');
    request.onsuccess = () => {
      const index = request.result.transaction('snapshots', 'readonly').objectStore('snapshots').index('workspaceId');
      const countRequest = index.count(id);
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    };
    request.onerror = () => reject(request.error);
  }), workspaceId);
  expect(count).toBeLessThanOrEqual(10);
});

test('HTML backup downloads and reimports portably', async ({ page }) => {
  await importHtml(page);
  await editTitle(page, '可攜式 HTML 備份');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出', exact: true }).click();
  const download = await downloadPromise;
  const bytes = await fs.readFile((await download.path())!);
  expect(bytes.toString('utf8')).toContain('可攜式 HTML 備份');
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'reimport.html', mimeType: 'text/html', buffer: bytes });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('可攜式 HTML 備份')).toBeVisible();
});

test('ZIP assets and scripts survive browser export and reimport', async ({ page }) => {
  const zip = new JSZip();
  zip.file('index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><section class="slide"><h1>ZIP 瀏覽器往返</h1><img src="assets/sample.svg"></section><script src="script.js"></script></body></html>');
  zip.file('styles.css', '.slide{width:1600px;height:900px}h1{color:#315fce}');
  zip.file('script.js', 'window.ZIP_SCRIPT_PRESERVED = true;');
  zip.file('assets/sample.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
  const source = await zip.generateAsync({ type: 'nodebuffer' });
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'portable.zip', mimeType: 'application/zip', buffer: source });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('ZIP 瀏覽器往返')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出', exact: true }).click();
  const exported = await fs.readFile((await (await downloadPromise).path())!);
  const reopened = await JSZip.loadAsync(exported);
  expect(await reopened.file('script.js')!.async('string')).toBe('window.ZIP_SCRIPT_PRESERVED = true;');
  expect(reopened.file('assets/sample.svg')).not.toBeNull();
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'reopened.zip', mimeType: 'application/zip', buffer: exported });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('img')).toBeVisible();
});

test('IndexedDB fallback works when OPFS is unavailable', async ({ page }) => {
  await page.goto('/?storage=idb');
  await importHtml(page, basicHtml('Fallback 工作區'));
  await editTitle(page, 'Fallback 已儲存');
  await page.reload();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('Fallback 已儲存')).toBeVisible();
  await openBrowserStorage(page);
  await expect(page.getByRole('region', { name: '瀏覽器儲存狀態' })).toContainText('IndexedDB fallback');
});

test('compatibility-mode HTML remains editable without executing imported scripts', async ({ page }) => {
  const html = '<!doctype html><html><head><style>.slide{display:flex;width:1600px;height:900px}.nested-transform{transform:scale(.9)}</style></head><body><section class="slide"><div class="nested-transform"><h1>相容模式</h1></div></section><script>parent.document.body.dataset.compromised="yes"</script></body></html>';
  await importHtml(page, html, 'compatibility.html');
  await expect(page.locator('.status-source').getByText('相容模式', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.compromised)).toBeUndefined();
});

test('Ctrl and Meta shortcut semantics work in browser mode', async ({ page, browserName }) => {
  await importHtml(page);
  const title = page.frameLocator('iframe[title="簡報編輯畫布"]').locator('h1');
  await title.click();
  await title.press(browserName === 'webkit' ? 'Meta+c' : 'Control+c');
  await title.press(browserName === 'webkit' ? 'Meta+v' : 'Control+v');
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').locator('h1')).toHaveCount(2);
});

test('20-page / 200-object synthetic workspace stays interactive', async ({ page }) => {
  const slides = Array.from({ length: 20 }, (_, slide) => `<section class="slide" data-title="第${slide + 1}頁">${Array.from({ length: 10 }, (_, object) => `<div style="position:absolute;left:${object * 60}px;top:${object * 40}px">${slide + 1}-${object + 1}</div>`).join('')}</section>`).join('');
  const start = Date.now();
  const html = `<!doctype html><html><head><style>.slide{position:relative;width:1600px;height:900px}</style></head><body><main>${slides}</main></body></html>`;
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'stress.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.getByRole('complementary', { name: '投影片縮圖' }).locator('iframe')).toHaveCount(20);
  await page.getByRole('button', { name: /編輯第 20 頁/ }).click();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('20-10')).toBeVisible();
  expect(Date.now() - start).toBeLessThan(15_000);
});

test('large bounded ZIP imports and exports within the documented limit', async ({ page }) => {
  const zip = new JSZip();
  zip.file('index.html', basicHtml('大型 ZIP'));
  zip.file('assets/large.bin', Buffer.alloc(5 * 1024 * 1024, 7));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('大型 ZIP')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出', exact: true }).click();
  const exported = await fs.readFile((await (await downloadPromise).path())!);
  const reopened = await JSZip.loadAsync(exported);
  expect((await reopened.file('assets/large.bin')!.async('uint8array')).byteLength).toBe(5 * 1024 * 1024);
});

test('preview remains sandboxed and storage survives preview transition', async ({ page }) => {
  await importHtml(page);
  await page.getByRole('button', { name: '預覽', exact: true }).click();
  await expect(page.frameLocator('iframe[title="簡報執行預覽"]').getByText('瀏覽器工作區')).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.compromised)).toBeUndefined();
  await page.getByRole('button', { name: '返回編輯' }).click();
  await expect(page.frameLocator('iframe[title="簡報編輯畫布"]').getByText('瀏覽器工作區')).toBeVisible();
});
