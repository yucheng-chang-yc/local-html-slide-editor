import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatches, inspectHtml } from '../../packages/editor-core/html-patch';
import { extractSpeakerNotes, maskSpeakerNotes, replaceSpeakerNotes } from '../../packages/editor-core/speaker-notes';

const fixture = path.resolve('fixtures', 'golden_actual_deck', 'index.html');

describe('實際九頁簡報黃金路徑核心', () => {
  it('精準修改複合文字而保留標籤、換行與其餘內容', async () => {
    const source = await fs.readFile(fixture, 'utf8');
    const inspected = inspectHtml(source);
    const card = inspected.elements.find((element) => element.directTextFragments.some((fragment) => fragment.text.includes('整理系統需求'))) !;
    const fragment = card.directTextFragments.find((item) => item.text.includes('整理系統需求'))!;
    const output = applyPatches(source, [{ type: 'replaceTextFragment', id: card.id, fragmentIndex: fragment.index, value: fragment.text.replace('整理系統需求', '整理系統要求') }]);
    expect(output).toContain('<span class="node-label">STEP 02</span>');
    expect(output).toContain('整理系統要求<br>與子系統項目');
    expect(inspectHtml(output).scriptBlocks).toEqual(inspected.scriptBlocks);
  });

  it('複製頁面、同步備註並保持備註以外 script 完全相同', async () => {
    const source = await fs.readFile(fixture, 'utf8');
    const inspected = inspectHtml(source);
    const slides = inspected.elements.filter((element) => element.attributes.class?.split(/\s+/).includes('slide'));
    const deck = inspected.elements.find((element) => element.attributes.id === 'deckStage')!;
    const notes = extractSpeakerNotes(source)!;
    expect(slides).toHaveLength(9);
    expect(notes).toHaveLength(9);
    const slideHtml = slides.map((slide) => source.slice(slide.startOffset, slide.endOffset));
    slideHtml.splice(2, 0, slideHtml[1].replace('第 2 頁', '第 3 頁'));
    const reordered = applyPatches(source, [{ type: 'replaceChildren', id: deck.id, html: `\n${slideHtml.join('\n')}\n` }]);
    const nextNotes = [...notes];
    nextNotes.splice(2, 0, `${notes[1]}\n副本補充`);
    const output = replaceSpeakerNotes(reordered, nextNotes);
    expect(inspectHtml(output).elements.filter((element) => element.attributes.class?.split(/\s+/).includes('slide'))).toHaveLength(10);
    expect(extractSpeakerNotes(output)).toEqual(nextNotes);
    expect(maskSpeakerNotes(output)).toBe(maskSpeakerNotes(reordered));
    expect(inspectHtml(maskSpeakerNotes(output)).scriptBlocks).toEqual(inspectHtml(maskSpeakerNotes(source)).scriptBlocks);
  });
});
