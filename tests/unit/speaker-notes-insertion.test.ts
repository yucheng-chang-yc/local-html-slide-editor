import { describe, expect, it } from 'vitest';
import { extractSpeakerNotes, maskSpeakerNotes, replaceSpeakerNotes } from '../../packages/editor-core/speaker-notes';

describe('speaker notes insertion', () => {
  it('adds a safe editor-owned block when the imported HTML has no notes array', () => {
    const source = '<!doctype html><html><body><script>window.keep = 7;</script></body></html>';
    const notes = ['first note', '</script><script>window.compromised = true</script>', 'line\u2028separator'];
    const output = replaceSpeakerNotes(source, notes);

    expect(extractSpeakerNotes(output)).toEqual(notes);
    expect(output).toContain('data-editor-speaker-notes');
    expect(output).not.toContain('</script><script>window.compromised');
    expect(output).toContain('\\u003c/script>');
    expect(maskSpeakerNotes(output)).toBe(source);
  });

  it('updates an existing editor-owned block without duplicating it', () => {
    const source = '<html><body></body></html>';
    const once = replaceSpeakerNotes(source, ['one']);
    const twice = replaceSpeakerNotes(once, ['two']);

    expect(extractSpeakerNotes(twice)).toEqual(['two']);
    expect(twice.match(/data-editor-speaker-notes/g)).toHaveLength(1);
    expect(maskSpeakerNotes(twice)).toBe(source);
  });
});
