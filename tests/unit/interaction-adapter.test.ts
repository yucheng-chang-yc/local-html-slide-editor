import { describe, expect, it } from 'vitest';
import { intersecting } from '../../packages/editor-core/interaction-adapter';

describe('interaction adapter geometry', () => {
  it('detects marquee intersection including edge contact', () => {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height } as DOMRect);
    expect(intersecting(rect(0, 0, 100, 100), rect(90, 90, 20, 20))).toBe(true);
    expect(intersecting(rect(0, 0, 100, 100), rect(101, 101, 20, 20))).toBe(false);
  });
});
