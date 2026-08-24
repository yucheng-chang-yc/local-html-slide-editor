import { describe, expect, it } from 'vitest';
import { applyPatches, inspectHtml, makeEditableHtml, sanitizeInsertedHtml } from '../../packages/editor-core/html-patch';

const source = `<!doctype html><html><head><script>window.keep = "exact";</script></head><body><main id="deck"><section class="slide"><h1 style="left:1px">原標題</h1><img src="a.png"></section></main></body></html>`;

describe('source-preserving HTML patch', () => {
  it('changes text and style without rewriting scripts', () => {
    const before = inspectHtml(source);
    const heading = before.elements.find((item) => item.tagName === 'h1')!;
    const output = applyPatches(source, [
      { type: 'setStyle', id: heading.id, value: 'left:20px;top:10px' },
      { type: 'replaceText', id: heading.id, value: '新標題' },
    ]);
    expect(output).toContain('style="left:20px;top:10px"');
    expect(output).toContain('>新標題</h1>');
    expect(inspectHtml(output).scriptBlocks).toEqual(before.scriptBlocks);
  });

  it('inserts and deletes using source locations', () => {
    const inspected = inspectHtml(source);
    const slide = inspected.elements.find((item) => item.tagName === 'section')!;
    const image = inspected.elements.find((item) => item.tagName === 'img')!;
    const output = applyPatches(source, [
      { type: 'deleteElement', id: image.id },
      { type: 'insertElement', parentId: slide.id, html: '<div style="position:absolute">新增</div>' },
    ]);
    expect(output).not.toContain('<img');
    expect(output).toContain('新增</div></section>');
  });

  it('disables source scripts in editable HTML', () => {
    const editable = makeEditableHtml(source, '/files/');
    expect(editable.html).toContain('type="text/plain" data-editor-disabled="true"');
    expect(editable.html).toContain('script-src \'none\'');
    expect(editable.html).toContain('data-editor-id="');
  });

  it('rejects active inserted content', () => {
    expect(() => sanitizeInsertedHtml('<script>alert(1)</script>')).toThrow();
    expect(() => sanitizeInsertedHtml('<div onclick="x()">x</div>')).toThrow();
  });

  it('adds a minimal inline formatting override without removing the source class', () => {
    const formattedSource = '<html><body><h2 class="source-heading">格式文字</h2><p class="untouched">保持不變</p></body></html>';
    const inspected = inspectHtml(formattedSource);
    const heading = inspected.elements.find((item) => item.attributes.class === 'source-heading')!;
    const output = applyPatches(formattedSource, [{
      type: 'setStyle',
      id: heading.id,
      value: 'font-family:Georgia,serif;font-size:42px;font-weight:900;text-align:center;line-height:1.45;color:#3366FF;',
    }]);
    expect(output).toContain('class="source-heading"');
    expect(output).toContain('font-size:42px');
    expect(output).toContain('<p class="untouched">保持不變</p>');
  });

  it('replaces only a deck container children region for page operations', () => {
    const inspected = inspectHtml(source);
    const deck = inspected.elements.find((item) => item.attributes.id === 'deck')!;
    const output = applyPatches(source, [{ type: 'replaceChildren', id: deck.id, html: '<section class="slide">副本</section><section class="slide">新增頁</section>' }]);
    expect(output).toContain('<main id="deck"><section class="slide">副本</section><section class="slide">新增頁</section></main>');
    expect(inspectHtml(output).scriptBlocks).toEqual(inspected.scriptBlocks);
  });
});
