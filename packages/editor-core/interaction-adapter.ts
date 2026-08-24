export type ResizeDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface CanonicalGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

export interface InteractionTransaction {
  kind: 'move' | 'resize' | 'rotate' | 'marquee';
  sourceIds: string[];
  before: CanonicalGeometry[];
  after?: CanonicalGeometry[];
}

export interface InteractionAdapter {
  viewportToSlide(x: number, y: number): { x: number; y: number };
  slideToViewport(x: number, y: number): { x: number; y: number };
  begin(kind: InteractionTransaction['kind'], elements: HTMLElement[]): InteractionTransaction;
  commit(transaction: InteractionTransaction, elements: HTMLElement[]): InteractionTransaction;
}

export function readCanonicalGeometry(element: HTMLElement): CanonicalGeometry {
  const rect = element.getBoundingClientRect();
  return {
    left: Number.parseFloat(element.style.left) || element.offsetLeft || rect.left,
    top: Number.parseFloat(element.style.top) || element.offsetTop || rect.top,
    width: Number.parseFloat(element.style.width) || element.offsetWidth || rect.width,
    height: Number.parseFloat(element.style.height) || element.offsetHeight || rect.height,
    rotation: Number(element.dataset.editorRotation ?? 0),
  };
}

export function selectionBounds(elements: HTMLElement[]): DOMRect {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function intersecting(a: DOMRect, b: DOMRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
