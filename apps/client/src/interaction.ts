import { intersecting, readCanonicalGeometry, selectionBounds, type InteractionAdapter, type ResizeDirection } from '../../../packages/editor-core/interaction-adapter';
import { detachFlowElementForMove, editorScale, prepareAbsolute, selectedContainer } from './editor';

type Options = {
  selected: () => HTMLElement[];
  select: (elements: HTMLElement[]) => void;
  before: () => string;
  commit: (before: string) => void;
  notify: (message: string) => void;
  gridEnabled: () => boolean;
  guidesEnabled: () => boolean;
};

const directions: ResizeDirection[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function sourceId(element: HTMLElement): string {
  return element.dataset.editorId ?? element.dataset.editorNew ?? 'anonymous';
}

function transformFor(element: HTMLElement): string {
  const angle = Number(element.dataset.editorRotation ?? 0);
  const flipX = element.dataset.editorFlipX === 'true' ? -1 : 1;
  const flipY = element.dataset.editorFlipY === 'true' ? -1 : 1;
  return `rotate(${angle}deg) scale(${flipX},${flipY})`;
}

const guideTolerance = 2;

function clearSmartGuides(document: Document): void {
  document.querySelectorAll('.editor-smart-guide,.editor-position-badge').forEach((element) => element.remove());
}

function showMeasureBadge(document: Document, text: string, clientX: number, clientY: number): void {
  document.querySelectorAll('.editor-position-badge').forEach((badge) => badge.remove());
  const badge = document.createElement('div');
  badge.className = 'editor-position-badge';
  badge.textContent = text;
  badge.style.cssText = `left:${clientX + 14}px;top:${clientY + 14}px`;
  document.body.append(badge);
}

function drawSmartGuide(document: Document, axis: 'x' | 'y', value: number, containerRect: DOMRect): void {
  const bodyRect = document.body.getBoundingClientRect();
  const scale = editorScale(document.body);
  const guide = document.createElement('div');
  guide.className = `editor-smart-guide ${axis === 'x' ? 'vertical' : 'horizontal'}`;
  if (axis === 'x') guide.style.cssText = `left:${(value - bodyRect.left) / scale.x}px;top:${(containerRect.top - bodyRect.top) / scale.y}px;width:${1 / scale.x}px;height:${containerRect.height / scale.y}px`;
  else guide.style.cssText = `left:${(containerRect.left - bodyRect.left) / scale.x}px;top:${(value - bodyRect.top) / scale.y}px;width:${containerRect.width / scale.x}px;height:${1 / scale.y}px`;
  document.body.append(guide);
}

function nearest(value: number, candidates: number[]): { value: number; delta: number } | null {
  const candidate = candidates.map((guide) => ({ value: guide, delta: guide - value })).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  return candidate && Math.abs(candidate.delta) <= guideTolerance ? candidate : null;
}

function guideCandidates(container: HTMLElement, selected: HTMLElement[]): { x: number[]; y: number[]; rect: DOMRect } {
  const rect = container.getBoundingClientRect();
  const candidates = [...container.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
    .filter((element) => !selected.includes(element) && !element.matches('[data-editor-free-layer="true"],[data-editor-flow-placeholder="true"]'));
  return {
    x: [rect.left, rect.left + rect.width / 2, rect.right, ...candidates.flatMap((element) => { const box = element.getBoundingClientRect(); return [box.left, box.left + box.width / 2, box.right]; })],
    y: [rect.top, rect.top + rect.height / 2, rect.bottom, ...candidates.flatMap((element) => { const box = element.getBoundingClientRect(); return [box.top, box.top + box.height / 2, box.bottom]; })],
    rect,
  };
}

export function createDomInteractionAdapter(document: Document): InteractionAdapter {
  const slide = () => document.querySelector<HTMLElement>('[data-editor-current-slide="true"]') ?? document.body;
  return {
    viewportToSlide(x, y) {
      const target = slide(); const rect = target.getBoundingClientRect(); const scale = editorScale(target);
      return { x: (x - rect.left) / scale.x, y: (y - rect.top) / scale.y };
    },
    slideToViewport(x, y) {
      const target = slide(); const rect = target.getBoundingClientRect(); const scale = editorScale(target);
      return { x: rect.left + x * scale.x, y: rect.top + y * scale.y };
    },
    begin(kind, elements) { return { kind, sourceIds: elements.map(sourceId), before: elements.map(readCanonicalGeometry) }; },
    commit(transaction, elements) { return { ...transaction, after: elements.map(readCanonicalGeometry) }; },
  };
}

export function installInteractionLayer(document: Document, options: Options): { render: () => void; destroy: () => void } {
  const adapter = createDomInteractionAdapter(document);
  const disposers: Array<() => void> = [];
  const root = document.createElement('div');
  root.className = 'editor-interaction-layer';
  document.body.append(root);

  const viewportRectToRoot = (rect: { left: number; top: number; width: number; height: number }) => {
    const rootRect = root.getBoundingClientRect();
    const scaleX = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    const scaleY = root.offsetHeight ? rootRect.height / root.offsetHeight : scaleX;
    return {
      left: (rect.left - rootRect.left) / (scaleX || 1),
      top: (rect.top - rootRect.top) / (scaleY || 1),
      width: rect.width / (scaleX || 1),
      height: rect.height / (scaleY || 1),
    };
  };

  const render = () => {
    if (!root.isConnected) document.body.append(root);
    root.replaceChildren();
    const elements = options.selected().filter((element) => element.isConnected && element.dataset.editorRestricted !== 'true');
    if (!elements.length) return;
    const bounds = selectionBounds(elements);
    const localBounds = viewportRectToRoot(bounds);
    const box = document.createElement('div');
    box.className = 'editor-selection-box';
    const isGroup = elements.length === 1 && elements[0].dataset.editorKind === 'group';
    box.dataset.selectionKind = isGroup ? 'group' : elements.length > 1 ? 'multi' : 'single';
    box.style.cssText = `left:${localBounds.left}px;top:${localBounds.top}px;width:${localBounds.width}px;height:${localBounds.height}px`;
    const badge = document.createElement('span');
    badge.className = 'editor-selection-badge';
    badge.textContent = isGroup ? '群組' : elements.length > 1 ? `多選 ${elements.length}` : '已選取';
    box.append(badge);
    root.append(box);
    for (const direction of directions) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `editor-transform-handle handle-${direction}${direction === 'se' ? ' editor-resize-handle' : ''}`;
      handle.dataset.direction = direction;
      handle.setAttribute('aria-label', `${direction} resize`);
      box.append(handle);
      handle.addEventListener('pointerdown', (event) => startResize(event, direction, elements));
    }
    const rotation = document.createElement('button');
    rotation.type = 'button';
    rotation.className = 'editor-rotation-handle';
    rotation.setAttribute('aria-label', '旋轉控制點');
    box.append(rotation);
    rotation.addEventListener('pointerdown', (event) => startRotate(event, elements));
  };

  const startResize = (event: PointerEvent, direction: ResizeDirection, elements: HTMLElement[]) => {
    event.preventDefault(); event.stopPropagation();
    const before = options.before();
    const transaction = adapter.begin('resize', elements);
    const bounds = selectionBounds(elements);
    const starts = elements.map((sourceElement) => {
      const sourceContainer = selectedContainer(document, sourceElement);
      const element = detachFlowElementForMove(document, sourceElement, sourceContainer);
      const container = selectedContainer(document, element);
      prepareAbsolute(element, (element.offsetParent as HTMLElement | null) ?? container);
      return { element, rect: element.getBoundingClientRect(), geometry: readCanonicalGeometry(element) };
    });
    const startX = event.clientX; const startY = event.clientY;
    const fromCenter = event.altKey;
    const horizontal = direction.includes('e') || direction.includes('w');
    const vertical = direction.includes('n') || direction.includes('s');
    const lockAspect = elements.length === 1 && elements[0].dataset.editorLockAspect === 'true';
    const move = (moveEvent: PointerEvent) => {
      let dx = moveEvent.clientX - startX; let dy = moveEvent.clientY - startY;
      if (direction.includes('w')) dx *= -1;
      if (direction.includes('n')) dy *= -1;
      let width = Math.max(12, bounds.width + (horizontal ? dx * (fromCenter ? 2 : 1) : 0));
      let height = Math.max(12, bounds.height + (vertical ? dy * (fromCenter ? 2 : 1) : 0));
      if (moveEvent.shiftKey || lockAspect) {
        const ratio = bounds.width / Math.max(1, bounds.height);
        if (Math.abs(dx) >= Math.abs(dy)) height = width / ratio; else width = height * ratio;
      }
      if (options.gridEnabled() && !moveEvent.altKey) {
        const container = selectedContainer(document, starts[0].element);
        const scale = editorScale(container);
        const snapToGrid = (value: number, step: number) => {
          const nearest = Math.round(value / step) * step;
          return Math.abs(nearest - value) <= 0.5 ? nearest : value;
        };
        if (horizontal) width = Math.max(12, snapToGrid(width, Math.max(1, scale.x * 10)));
        if (vertical) height = Math.max(12, snapToGrid(height, Math.max(1, scale.y * 10)));
      }
      const sx = width / Math.max(1, bounds.width); const sy = height / Math.max(1, bounds.height);
      for (const start of starts) {
        const parent = (start.element.offsetParent as HTMLElement | null) ?? selectedContainer(document, start.element);
        const scale = editorScale(parent);
        const relLeft = start.rect.left - bounds.left; const relTop = start.rect.top - bounds.top;
        const anchorShiftX = direction.includes('w') ? bounds.width - width : fromCenter ? (bounds.width - width) / 2 : 0;
        const anchorShiftY = direction.includes('n') ? bounds.height - height : fromCenter ? (bounds.height - height) / 2 : 0;
        start.element.style.left = `${start.geometry.left + (relLeft * sx - relLeft + anchorShiftX) / scale.x}px`;
        start.element.style.top = `${start.geometry.top + (relTop * sy - relTop + anchorShiftY) / scale.y}px`;
        start.element.style.width = `${Math.max(12, start.geometry.width * sx)}px`;
        start.element.style.height = `${Math.max(12, start.geometry.height * sy)}px`;
      }
      clearSmartGuides(document);
      showMeasureBadge(document, `${Math.round(width)} × ${Math.round(height)}`, moveEvent.clientX, moveEvent.clientY);
      if (options.guidesEnabled() && !moveEvent.altKey) {
        const resized = selectionBounds(elements);
        const container = selectedContainer(document, starts[0].element);
        const candidates = guideCandidates(container, elements);
        const x = horizontal ? nearest(direction.includes('w') ? resized.left : resized.right, candidates.x) : null;
        const y = vertical ? nearest(direction.includes('n') ? resized.top : resized.bottom, candidates.y) : null;
        if (x || y) {
          for (const start of starts) {
            const parent = (start.element.offsetParent as HTMLElement | null) ?? container;
            const scale = editorScale(parent);
            if (x) {
              if (direction.includes('w')) {
                start.element.style.left = `${Number.parseFloat(start.element.style.left) + x.delta / scale.x}px`;
                start.element.style.width = `${Math.max(12, Number.parseFloat(start.element.style.width) - x.delta / scale.x)}px`;
              } else start.element.style.width = `${Math.max(12, Number.parseFloat(start.element.style.width) + x.delta / scale.x)}px`;
            }
            if (y) {
              if (direction.includes('n')) {
                start.element.style.top = `${Number.parseFloat(start.element.style.top) + y.delta / scale.y}px`;
                start.element.style.height = `${Math.max(12, Number.parseFloat(start.element.style.height) - y.delta / scale.y)}px`;
              } else start.element.style.height = `${Math.max(12, Number.parseFloat(start.element.style.height) + y.delta / scale.y)}px`;
            }
          }
          if (x) drawSmartGuide(document, 'x', x.value, candidates.rect);
          if (y) drawSmartGuide(document, 'y', y.value, candidates.rect);
        }
      }
      render();
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      clearSmartGuides(document);
      adapter.commit(transaction, elements); options.commit(before); render();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  const startRotate = (event: PointerEvent, elements: HTMLElement[]) => {
    event.preventDefault(); event.stopPropagation();
    const before = options.before(); const transaction = adapter.begin('rotate', elements);
    const bounds = selectionBounds(elements); const cx = bounds.left + bounds.width / 2; const cy = bounds.top + bounds.height / 2;
    const start = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI;
    const angles = elements.map((element) => Number(element.dataset.editorRotation ?? 0));
    const move = (moveEvent: PointerEvent) => {
      let delta = Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * 180 / Math.PI - start;
      if (moveEvent.shiftKey) delta = Math.round(delta / 15) * 15;
      elements.forEach((element, index) => {
        element.dataset.editorRotation = String(Math.round((angles[index] + delta) * 10) / 10);
        element.style.transform = transformFor(element);
      });
      showMeasureBadge(document, `${Math.round((angles[0] + delta) * 10) / 10}°`, moveEvent.clientX, moveEvent.clientY);
      render();
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      clearSmartGuides(document);
      adapter.commit(transaction, elements); options.commit(before); render();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  const startMarquee = (event: PointerEvent) => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-id],[data-editor-new],.editor-interaction-layer');
    if (event.button !== 0 || (hit && !hit.matches('.slide,[data-slide],[data-editor-free-layer="true"]'))) return;
    const slide = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-current-slide="true"]');
    if (!slide) return;
    const startX = event.clientX; const startY = event.clientY;
    const marquee = document.createElement('div'); marquee.className = 'editor-marquee'; root.append(marquee);
    const move = (moveEvent: PointerEvent) => {
      const left = Math.min(startX, moveEvent.clientX); const top = Math.min(startY, moveEvent.clientY);
      const local = viewportRectToRoot({ left, top, width: Math.abs(moveEvent.clientX - startX), height: Math.abs(moveEvent.clientY - startY) });
      marquee.style.cssText = `left:${local.left}px;top:${local.top}px;width:${local.width}px;height:${local.height}px`;
    };
    const up = (upEvent: PointerEvent) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); marquee.remove();
      const area = new DOMRect(Math.min(startX, upEvent.clientX), Math.min(startY, upEvent.clientY), Math.abs(upEvent.clientX - startX), Math.abs(upEvent.clientY - startY));
      if (area.width > 4 || area.height > 4) {
        const selected = [...slide.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
          .filter((element) => {
            if (element.matches('[data-editor-free-layer="true"],[data-editor-flow-placeholder="true"],.slide,[data-slide]')) return false;
            const ancestor = element.parentElement?.closest<HTMLElement>('[data-editor-id],[data-editor-new]');
            const isTopObject = !ancestor || ancestor.dataset.editorKind === 'free-layer' || ancestor.matches('.slide,[data-slide]');
            return isTopObject && intersecting(area, element.getBoundingClientRect());
          });
        options.select(selected); options.notify(`框選 ${selected.length} 個物件`); render();
      } else options.select([]);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  document.addEventListener('pointerdown', startMarquee);
  disposers.push(() => document.removeEventListener('pointerdown', startMarquee));
  const onViewport = () => render();
  document.defaultView?.addEventListener('resize', onViewport);
  disposers.push(() => document.defaultView?.removeEventListener('resize', onViewport));
  return { render, destroy: () => { disposers.forEach((dispose) => dispose()); root.remove(); } };
}

export function applyElementTransform(element: HTMLElement): void { element.style.transform = transformFor(element); }
