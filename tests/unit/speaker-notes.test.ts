import { describe, expect, it } from 'vitest';
import { extractSpeakerNotes, maskSpeakerNotes, replaceSpeakerNotes } from '../../packages/editor-core/speaker-notes';

describe('安全講者備註解析器', () => {
  it('只解析靜態字串、串接與註解', () => {
    const source = `<script>const keep = 7; var SPEAKER_NOTES = [// 1\n"甲" + "\\n乙", /* 2 */ '丙']; const tail = 9;</script>`;
    expect(extractSpeakerNotes(source)).toEqual(['甲\n乙', '丙']);
    const output = replaceSpeakerNotes(source, ['更新一', '更新二']);
    expect(extractSpeakerNotes(output)).toEqual(['更新一', '更新二']);
    expect(maskSpeakerNotes(output)).toBe(maskSpeakerNotes(source));
  });

  it('遇到動態運算式會 fail closed 且不執行來源', () => {
    const source = `<script>var SPEAKER_NOTES = [window.secret, "靜態"];</script>`;
    expect(extractSpeakerNotes(source)).toBeNull();
    expect(() => replaceSpeakerNotes(source, ['不可寫入'])).toThrow();
  });
});
