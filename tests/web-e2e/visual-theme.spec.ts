import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = path.resolve('fixtures', 'golden_actual_deck', 'index.html');
const evidence = path.resolve(process.env.THEME_VISUAL_EVIDENCE_DIR ?? 'evidence/web-browser/theme-shell');
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
];

async function importFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({
    name: 'golden_actual_deck.html',
    mimeType: 'text/html',
    buffer: await fs.readFile(fixture),
  });
  await expect(page.locator('.workspace-layout')).toBeVisible();
  await page.locator('.ribbon-tabs button').nth(3).click();
  await page.locator('.ribbon-content .toolbar-group .toolbar-buttons > button').nth(2).click();
}

test.beforeAll(async () => { await fs.mkdir(evidence, { recursive: true }); });

for (const viewport of viewports) {
  test(`visual shell remains contained at ${viewport.width}x${viewport.height}`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    await importFixture(page);

    await expect(page.locator('.canvas-frame')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `${browserName}-${viewport.width}x${viewport.height}.png`) });
  });
}

test('visual states remain distinguishable and keyboard-visible', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await importFixture(page);
  await page.locator('.ribbon-tabs button').first().click();
  const alignment = page.locator('details.alignment-menu').first();
  await alignment.locator('summary').click();
  const toolbarDisabled = alignment.locator('.command-menu-panel button:disabled').first();
  await expect(toolbarDisabled).toBeVisible();
  await alignment.locator('summary').click();
  const frame = page.frameLocator('iframe.canvas-frame').first();
  await frame.locator('[data-editor-current-slide="true"] h1').first().click();
  await expect(page.locator('.text-inspector')).toBeVisible();
  const active = page.locator('.ribbon-tabs button.active');
  await active.focus();
  await page.keyboard.press('Tab');

  const state = await page.evaluate(() => {
    const css = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    const disabled = css('.slide-switcher button:disabled');
    const selected = css('.slide-item.active');
    const focused = getComputedStyle(document.activeElement as Element);
    return {
      disabledBackground: disabled?.backgroundColor,
      disabledColor: disabled?.color,
      selectedBackground: selected?.backgroundColor,
      selectedBorder: selected?.borderColor,
      focusOutline: focused?.outlineStyle,
      focusShadow: focused?.boxShadow,
      warningBackground: getComputedStyle(document.documentElement).getPropertyValue('--ui-warning-bg').trim(),
      warningText: getComputedStyle(document.documentElement).getPropertyValue('--ui-warning-text').trim(),
    };
  });
  expect(state.disabledBackground).not.toBe(state.selectedBackground);
  expect(state.disabledColor).not.toBe(state.selectedBorder);
  expect(state.focusOutline).not.toBe('none');
  expect(state.focusShadow).not.toBe('none');
  expect(state.warningBackground).not.toBe(state.selectedBackground);
  expect(state.warningText).not.toBe(state.disabledColor);
  await page.screenshot({ path: path.join(evidence, `${browserName}-states-1440x900.png`) });
});

test('neutral premium shell uses restrained hierarchy without blue chrome', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await importFixture(page);

  const shell = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const css = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    const topbar = css('.topbar');
    const ribbon = css('.ribbon-content');
    const workspace = css('.workspace');
    const inspector = css('.text-inspector, .inspector-spacer');
    return {
      appBackground: root.getPropertyValue('--ui-bg-app').trim(),
      accent: root.getPropertyValue('--ui-accent').trim(),
      primary: root.getPropertyValue('--ui-primary').trim(),
      topbarBackground: topbar?.backgroundColor,
      toolbarHeight: ribbon?.minHeight,
      canvasSurround: workspace?.backgroundColor,
      inspectorBackground: inspector?.backgroundColor,
      toolbarImage: ribbon?.backgroundImage,
      topbarImage: topbar?.backgroundImage,
    };
  });

  expect(shell).toEqual({
    appBackground: '#f3f4f5',
    accent: '#454a50',
    primary: '#25282c',
    topbarBackground: 'rgb(255, 255, 255)',
    toolbarHeight: '46px',
    canvasSurround: 'rgb(236, 239, 241)',
    inspectorBackground: 'rgb(255, 255, 255)',
    toolbarImage: 'none',
    topbarImage: 'none',
  });
  await page.screenshot({ path: path.join(evidence, `${browserName}-neutral-premium-1440x900.png`) });
});

test('structural shell changes command context and uses responsive panel drawers', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await importFixture(page);
  await page.getByRole('button', { name: '常用', exact: true }).click();

  const commandBar = page.locator('.contextual-command-bar');
  await expect(commandBar).toHaveAttribute('data-command-context', 'slide');
  await expect(commandBar.getByRole('button', { name: '新增頁面', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell > section.notice')).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, `${browserName}-commands-slide.png`) });

  const frame = page.frameLocator('iframe.canvas-frame').first();
  await frame.locator('[data-editor-current-slide="true"] h1').first().click();
  await expect(commandBar).toHaveAttribute('data-command-context', 'text');
  await expect(commandBar.getByRole('button', { name: '粗體', exact: true })).toBeVisible();
  await expect(commandBar.getByRole('button', { name: '新增頁面', exact: true })).toBeHidden();
  await page.screenshot({ path: path.join(evidence, `${browserName}-commands-text.png`) });

  await page.getByRole('button', { name: '插入', exact: true }).click();
  await page.locator('details.shape-menu summary').click();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await expect(commandBar).toHaveAttribute('data-command-context', 'object');
  await page.getByRole('button', { name: '常用', exact: true }).click();
  await expect(commandBar.getByRole('button', { name: '上移一層', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, `${browserName}-commands-object.png`) });

  const shape = frame.locator('[data-editor-kind="rectangle"]').last();
  const title = frame.locator('[data-editor-current-slide="true"] h1').first();
  await shape.click();
  await title.click({ modifiers: ['Control'] });
  await expect(commandBar).toHaveAttribute('data-command-context', 'multi');
  const visibleCommands = commandBar.locator('.contextual-commands');
  await expect(visibleCommands.locator('details.group-menu summary')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, `${browserName}-commands-multi.png`) });
  await visibleCommands.locator('details.group-menu summary').click();
  await visibleCommands.getByRole('button', { name: '組成群組', exact: true }).click();
  await expect(commandBar).toHaveAttribute('data-command-context', 'group');
  await page.screenshot({ path: path.join(evidence, `${browserName}-commands-group.png`) });

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-viewport', 'compact');
  await expect.poll(async () => (await page.locator('.slide-rail').boundingBox())?.width ?? 999).toBeLessThanOrEqual(60);
  await expect(page.locator('#inspector-panel')).toHaveAttribute('aria-hidden', 'true');
  const inspectorToggle = page.getByRole('button', { name: '屬性', exact: true });
  await inspectorToggle.click();
  await expect(page.locator('#inspector-panel')).toHaveAttribute('aria-hidden', 'false');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(evidence, `${browserName}-drawer-inspector-1024x768.png`) });
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(inspectorToggle).toBeFocused();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-viewport', 'drawer');
  await expect(page.locator('#slide-rail')).toHaveAttribute('aria-hidden', 'true');
  await page.getByRole('button', { name: '投影片', exact: true }).click();
  await expect(page.locator('#slide-rail')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#slide-rail iframe')).toHaveCount(9);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: '預覽', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '匯出', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, `${browserName}-drawer-rail-768x1024.png`) });
});
