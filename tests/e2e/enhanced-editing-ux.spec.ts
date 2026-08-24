import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('multi-selection clarity and advanced text colors remain functional', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'supported.html',
    mimeType: 'text/html',
    buffer: await fs.readFile(path.resolve('fixtures', 'supported_fixed_canvas', 'index.html')),
  });

  const frame = page.frameLocator('iframe.canvas-frame').first();
  await expect(frame.locator('.editor-alignment-grid')).toHaveCount(0);
  await page.locator('.ribbon-tabs button').nth(3).click();
  const gridToggle = page.getByRole('button', { name: '格線', exact: true });
  await gridToggle.click();
  await expect(frame.locator('.editor-alignment-grid')).toHaveCount(1);
  await gridToggle.click();
  await expect(frame.locator('.editor-alignment-grid')).toHaveCount(0);

  const title = frame.locator('#title-1');
  const subtitle = frame.locator('#subtitle-1');
  await title.click();
  await subtitle.click({ modifiers: ['Control'] });
  await expect(frame.locator('.editor-selection-box[data-selection-kind="multi"]')).toHaveCount(1);
  await expect(frame.locator('.editor-selection-badge')).toContainText('2');

  await title.click();
  await expect(page.locator('.text-inspector .palette button')).toHaveCount(24);
  const customHex = page.getByLabel('自訂 HEX');
  await customHex.fill('#123456');
  await customHex.press('Enter');
  await expect.poll(() => title.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(18, 52, 86)');
  await expect(page.locator('.recent-palette .recent-color')).toHaveCount(1);
});

test('layer controls move one step and expose truthful boundaries', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'supported.html',
    mimeType: 'text/html',
    buffer: await fs.readFile(path.resolve('fixtures', 'supported_fixed_canvas', 'index.html')),
  });

  const frame = page.frameLocator('iframe.canvas-frame').first();
  await page.getByRole('button', { name: '插入', exact: true }).click();
  await page.locator('details.shape-menu summary').click();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await page.locator('details.shape-menu summary').click();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  const rectangles = frame.locator('[data-editor-kind="rectangle"]');
  await expect(rectangles).toHaveCount(2);
  const selected = rectangles.nth(1);
  await expect(selected).toHaveClass(/editor-selected/);

  await page.getByRole('button', { name: '常用', exact: true }).click();
  const moveUp = page.getByRole('button', { name: '上移一層' });
  const moveDown = page.getByRole('button', { name: '下移一層' });
  await expect(moveUp).toBeDisabled();
  await expect(moveDown).toBeEnabled();
  await moveDown.click();
  await expect(moveDown).toBeDisabled();
  await expect(moveUp).toBeEnabled();
  expect(await rectangles.nth(1).evaluate((element) => getComputedStyle(element).zIndex)).toBe('1');
  expect(await rectangles.nth(0).evaluate((element) => getComputedStyle(element).zIndex)).toBe('2');
  await moveUp.click();
  await expect(moveUp).toBeDisabled();
  await expect(moveDown).toBeEnabled();
});
