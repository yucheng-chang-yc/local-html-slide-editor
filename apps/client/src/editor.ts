import type { PatchOperation } from '../../../packages/editor-core/types';

export interface BaselineElement {
  id: string;
  text: string;
  canEditText: boolean;
  style: string;
  src: string | null;
  isSlide: boolean;
  innerHtml: string;
}

export interface TextInspectorStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  color: string;
}

export interface EditorDeckController {
  slideCount: number;
  currentIndex: number;
  initiallyAllHidden: boolean;
  show(index: number): number;
}

const runtimeDecorationOwner = 'data-editor-runtime-decoration-owner';
const runtimeDecorationVariable = 'data-editor-runtime-decoration-variable';
const runtimeDecorationOriginal = 'data-editor-runtime-decoration-original';

function collectCssRules(rules: CSSRuleList, output: CSSStyleRule[] = []): CSSStyleRule[] {
  for (const rule of [...rules]) {
    if ('selectorText' in rule && 'style' in rule) output.push(rule as CSSStyleRule);
    else if ('cssRules' in rule) {
      try { collectCssRules((rule as CSSGroupingRule).cssRules, output); } catch { /* Ignore inaccessible nested rules. */ }
    }
  }
  return output;
}

function decorationVariable(document: Document, owner: HTMLElement, pseudo: 'before' | 'after'): string | null {
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSStyleRule[];
    try { rules = collectCssRules(sheet.cssRules); } catch { continue; }
    for (const rule of rules) {
      for (const selector of rule.selectorText.split(',')) {
        const marker = `::${pseudo}`;
        if (!selector.includes(marker)) continue;
        const base = selector.slice(0, selector.indexOf(marker)).trim();
        if (!base) continue;
        try { if (!owner.matches(base)) continue; } catch { continue; }
        const background = rule.style.getPropertyValue('background-color') || rule.style.getPropertyValue('background');
        const variable = /var\(\s*(--[\w-]+)/.exec(background)?.[1];
        if (variable) return variable;
      }
    }
  }
  return null;
}

function copyDecorationStyle(source: CSSStyleDeclaration, target: CSSStyleDeclaration): void {
  for (const property of [
    'display', 'width', 'height', 'min-width', 'min-height', 'background', 'background-color',
    'border', 'border-radius', 'box-shadow', 'opacity', 'margin', 'margin-left', 'margin-right',
    'margin-top', 'margin-bottom', 'vertical-align', 'transform', 'transform-origin', 'position',
    'left', 'right', 'top', 'bottom', 'align-self', 'flex',
  ]) {
    const value = source.getPropertyValue(property);
    if (value) target.setProperty(property, value);
  }
  target.setProperty('pointer-events', 'auto');
  target.setProperty('cursor', 'pointer');
  target.setProperty('box-sizing', 'border-box');
}

function transparentColour(value: string): boolean {
  return value === 'transparent' || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)/.test(value);
}

function restoreRuntimeDecorationOwner(owner: HTMLElement): void {
  const variable = owner.getAttribute(runtimeDecorationVariable);
  const original = decodeURIComponent(owner.getAttribute(runtimeDecorationOriginal) ?? '');
  if (variable) {
    if (original) owner.style.setProperty(variable, original);
    else owner.style.removeProperty(variable);
  }
  owner.removeAttribute(runtimeDecorationOwner);
  owner.removeAttribute(runtimeDecorationVariable);
  owner.removeAttribute(runtimeDecorationOriginal);
}

/** Expose simple empty pseudo-elements as source-safe runtime proxies. */
export function installEditableDecorations(document: Document): void {
  document.querySelectorAll('.editor-runtime-decoration-proxy').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>(`[${runtimeDecorationOwner}]`).forEach((owner) => restoreRuntimeDecorationOwner(owner));
  for (const owner of document.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')) {
    if (owner.matches('.slide,[data-slide],[data-editor-free-layer="true"],style,script') || owner.closest('[data-editor-restricted="true"]')) continue;
    for (const pseudo of ['before', 'after'] as const) {
      if (owner.querySelector(`:scope > .editor-exported-decoration-${pseudo}`)) continue;
      const computed = getComputedStyle(owner, `::${pseudo}`);
      const width = Number.parseFloat(computed.width);
      const height = Number.parseFloat(computed.height);
      const hasPaint = !transparentColour(computed.backgroundColor) || computed.borderStyle !== 'none';
      if (!['""', "''"].includes(computed.content) || computed.display === 'none' || !hasPaint || !(width >= 3) || !(height >= 3)) continue;
      const variable = decorationVariable(document, owner, pseudo);
      if (!variable) continue;
      const proxy = document.createElement('span');
      proxy.className = 'editor-runtime-decoration-proxy';
      proxy.dataset.editorRuntimeDecorationProxy = pseudo;
      proxy.dataset.editorKind = 'decoration';
      proxy.setAttribute('aria-label', pseudo === 'before' ? '前置裝飾' : '後置裝飾');
      proxy.title = '點一下轉為可獨立調整的裝飾物件';
      proxy.tabIndex = 0;
      copyDecorationStyle(computed, proxy.style);
      const original = owner.style.getPropertyValue(variable);
      owner.setAttribute(runtimeDecorationOwner, pseudo);
      owner.setAttribute(runtimeDecorationVariable, variable);
      owner.setAttribute(runtimeDecorationOriginal, encodeURIComponent(original));
      owner.style.setProperty(variable, 'transparent');
      if (pseudo === 'before') owner.prepend(proxy); else owner.append(proxy);
    }
  }
}

export function cleanRuntimeDecorations(root: ParentNode): void {
  root.querySelectorAll('.editor-runtime-decoration-proxy').forEach((element) => element.remove());
  root.querySelectorAll<HTMLElement>(`[${runtimeDecorationOwner}]`).forEach((owner) => restoreRuntimeDecorationOwner(owner));
}

export function promoteEditableDecoration(proxy: HTMLElement): HTMLElement | null {
  const owner = proxy.parentElement;
  const pseudo = proxy.dataset.editorRuntimeDecorationProxy as 'before' | 'after' | undefined;
  if (!owner || !pseudo) return null;
  proxy.classList.remove('editor-runtime-decoration-proxy');
  proxy.classList.add(`editor-exported-decoration-${pseudo}`);
  delete proxy.dataset.editorRuntimeDecorationProxy;
  proxy.dataset.editorNew = crypto.randomUUID();
  proxy.dataset.editorKind = 'decoration';
  proxy.dataset.editorFreePosition = 'true';
  owner.removeAttribute(runtimeDecorationOwner);
  owner.removeAttribute(runtimeDecorationVariable);
  owner.removeAttribute(runtimeDecorationOriginal);
  return proxy;
}

export function createEditorDeckController(document: Document): EditorDeckController | null {
  const selector = '.slide,[data-slide]';
  const slides = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => !element.parentElement?.closest(selector));
  if (!slides.length) return null;
  const rememberedCurrent = slides.findIndex((element) => element.dataset.editorCurrentSlide === 'true');
  document.querySelectorAll('style[data-editor-runtime="deck-visibility"]').forEach((element) => element.remove());
  slides.forEach((element) => {
    element.removeAttribute('data-editor-deck-slide');
    element.removeAttribute('data-editor-current-slide');
  });
  const isHidden = (element: HTMLElement) => {
    const computed = getComputedStyle(element);
    return computed.display === 'none' || computed.visibility === 'hidden' || Number.parseFloat(computed.opacity) === 0;
  };
  const initiallyAllHidden = slides.every(isHidden);
  const current = rememberedCurrent >= 0 ? rememberedCurrent : slides.findIndex((element) => !isHidden(element));
  slides.forEach((element) => { element.dataset.editorDeckSlide = 'true'; });
  const style = document.createElement('style');
  style.dataset.editorRuntime = 'deck-visibility';
  style.textContent = `
[data-editor-deck-slide="true"]{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
[data-editor-deck-slide="true"][data-editor-current-slide="true"]{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;z-index:1!important}
[data-editor-deck-slide="true"][data-editor-current-slide="true"] .reveal,[data-editor-deck-slide="true"][data-editor-current-slide="true"] [data-frag]{visibility:visible!important;opacity:1!important;transition:none!important}
`;
  document.head.append(style);
  // Entrance-animation offsets (.reveal/[data-frag]) never get their normal
  // `.slide.visible` transform reset because the source deck's own script is
  // disabled in edit mode. Neutralize the leftover transform inline (not via
  // !important) so it never fights a real user rotation/flip applied later,
  // and so it can't confuse offsetParent/geometry math for nested drag targets.
  // Applied once, up front, across every slide (not just the current one) so
  // captureBaseline sees the same neutralized state no matter which slide is
  // navigated to later; otherwise a later-visited slide's neutralization
  // would look like a real style edit and get baked into the export.
  for (const slide of slides) {
    slide.querySelectorAll<HTMLElement>('.reveal,[data-frag]').forEach((element) => {
      const hasUserTransform = Boolean(element.dataset.editorRotation) || element.dataset.editorFlipX === 'true' || element.dataset.editorFlipY === 'true';
      if (!hasUserTransform) element.style.setProperty('transform', 'none');
    });
  }
  const controller: EditorDeckController = {
    slideCount: slides.length,
    currentIndex: Math.max(0, current),
    initiallyAllHidden,
    show(index: number) {
      const next = Math.max(0, Math.min(index, slides.length - 1));
      slides.forEach((element) => element.removeAttribute('data-editor-current-slide'));
      slides[next]?.setAttribute('data-editor-current-slide', 'true');
      controller.currentIndex = next;
      return next;
    },
  };
  controller.show(controller.currentIndex);
  return controller;
}

export function captureBaseline(document: Document): Map<string, BaselineElement> {
  return new Map([...document.querySelectorAll<HTMLElement>('[data-editor-id]')].map((element) => [
    element.dataset.editorId!,
    {
      id: element.dataset.editorId!,
      text: element.textContent ?? '',
      canEditText: element.children.length === 0 && element.tagName !== 'IMG',
      style: element.getAttribute('style') ?? '',
      src: element.getAttribute('src'),
      isSlide: element.matches('.slide,[data-slide]') && !element.parentElement?.closest('.slide,[data-slide]'),
      innerHtml: element.innerHTML,
    },
  ]));
}

export function cleanInserted(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('[data-editor-text-owner]').forEach((fragment) => fragment.replaceWith(fragment.ownerDocument.createTextNode(fragment.textContent ?? '')));
  clone.querySelectorAll('.editor-selection-box,.editor-resize-handle,.editor-alignment-grid').forEach((item) => item.remove());
  clone.querySelectorAll<HTMLElement>('*').forEach((item) => {
    item.removeAttribute('data-editor-id'); item.removeAttribute('data-editor-new'); item.removeAttribute('contenteditable');
    item.classList.remove('editor-selected'); item.removeAttribute('data-editor-restricted');
    item.removeAttribute('data-editor-restricted-reason'); item.removeAttribute('data-editor-deck-slide');
    item.removeAttribute('data-editor-current-slide'); item.removeAttribute('data-editor-grid-visible');
    item.removeAttribute('data-editor-source-consumed'); item.removeAttribute('data-editor-detached');
    item.removeAttribute('data-editor-lock-aspect');
    item.removeAttribute('data-editor-rich-text');
  });
  clone.removeAttribute('data-editor-id'); clone.removeAttribute('data-editor-new'); clone.removeAttribute('contenteditable');
  clone.classList.remove('editor-selected'); clone.removeAttribute('data-editor-restricted');
  clone.removeAttribute('data-editor-restricted-reason'); clone.removeAttribute('data-editor-deck-slide');
  clone.removeAttribute('data-editor-current-slide'); clone.removeAttribute('data-editor-grid-visible');
  clone.removeAttribute('data-editor-source-consumed'); clone.removeAttribute('data-editor-detached');
  clone.removeAttribute('data-editor-lock-aspect');
  clone.removeAttribute('data-editor-rich-text');
  return clone.outerHTML;
}

function cleanRichInnerHtml(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('[data-editor-text-owner]').forEach((fragment) => fragment.replaceWith(...fragment.childNodes));
  clone.querySelectorAll('.editor-interaction-layer,.editor-selection-box,.editor-marquee,.editor-smart-guide,.editor-alignment-grid').forEach((item) => item.remove());
  for (const item of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
    item.removeAttribute('contenteditable');
    for (const attribute of [...item.attributes]) if (attribute.name.startsWith('data-editor-')) item.removeAttribute(attribute.name);
    item.classList.remove('editor-selected');
  }
  return clone.innerHTML;
}

export function buildOperations(document: Document, baseline: Map<string, BaselineElement>): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const currentSlides = [...document.querySelectorAll<HTMLElement>('.slide,[data-slide]')]
    .filter((element) => !element.parentElement?.closest('.slide,[data-slide]'));
  const baselineSlideIds = [...baseline.values()].filter((element) => element.isSlide).map((element) => element.id);
  const currentSlideIds = currentSlides.map((element) => element.dataset.editorId ?? `new:${element.dataset.editorNew ?? ''}`);
  const pageStructureChanged = currentSlides.length > 0 && JSON.stringify(currentSlideIds) !== JSON.stringify(baselineSlideIds);
  const deckParent = pageStructureChanged ? currentSlides[0]?.parentElement : null;
  const deckParentId = deckParent?.dataset.editorId;
  if (pageStructureChanged && deckParentId) {
    operations.push({ type: 'replaceChildren', id: deckParentId, html: `\n${currentSlides.map(cleanInserted).join('\n')}\n` });
  }
  for (const [id, initial] of baseline) {
    const element = document.querySelector<HTMLElement>(`[data-editor-id="${id}"]`);
    if (pageStructureChanged && deckParent && (element === deckParent || element?.closest('[data-editor-id]') === deckParent || element?.closest('.slide,[data-slide]'))) continue;
    if (!element || element.dataset.editorSourceConsumed === 'true') { operations.push({ type: 'deleteElement', id }); continue; }
    const style = element.hasAttribute(runtimeDecorationOwner)
      ? (() => {
          const clone = element.cloneNode(false) as HTMLElement;
          restoreRuntimeDecorationOwner(clone);
          return clone.getAttribute('style') ?? '';
        })()
      : element.getAttribute('style') ?? '';
    if (style !== initial.style) operations.push({ type: 'setStyle', id, value: style });
    if (element.dataset.editorRichText === 'true' && element.innerHTML !== initial.innerHtml) {
      operations.push({ type: 'replaceInnerHtml', id, value: cleanRichInnerHtml(element) });
    } else if (initial.canEditText && (element.textContent ?? '') !== initial.text) operations.push({ type: 'replaceText', id, value: element.textContent ?? '' });
    const src = element.getAttribute('src');
    if (src !== initial.src && src !== null) operations.push({ type: 'setAttribute', id, name: 'src', value: src });
  }
  for (const fragment of document.querySelectorAll<HTMLElement>('[data-editor-text-owner][data-editor-text-index][data-editor-text-original]')) {
    if (pageStructureChanged && fragment.closest('.slide,[data-slide]')) continue;
    const ownerId = fragment.dataset.editorTextOwner;
    const fragmentIndex = Number(fragment.dataset.editorTextIndex);
    const original = fragment.dataset.editorTextOriginal;
    if (!ownerId || !Number.isInteger(fragmentIndex) || original === undefined) continue;
    if (encodeURIComponent(fragment.textContent ?? '') !== original) {
      operations.push({ type: 'replaceTextFragment', id: ownerId, fragmentIndex, value: fragment.textContent ?? '' });
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-editor-new]')) {
    if (pageStructureChanged && element.closest('.slide,[data-slide]')) continue;
    if (element.parentElement?.closest('[data-editor-new]')) continue;
    const parent = element.parentElement?.closest<HTMLElement>('[data-editor-id]');
    if (parent?.dataset.editorId) operations.push({ type: 'insertElement', parentId: parent.dataset.editorId, html: cleanInserted(element) });
  }
  return operations;
}

export function selectedContainer(document: Document, selected: HTMLElement | null): HTMLElement {
  return selected?.closest<HTMLElement>('.slide,[data-slide],section,[role="region"]')
    ?? document.querySelector<HTMLElement>('[data-editor-current-slide="true"]')
    ?? document.querySelector<HTMLElement>('.slide,[data-slide],section,[role="region"]')
    ?? document.body;
}

export function freePositionLayer(document: Document, selected: HTMLElement | null): HTMLElement {
  const container = selectedContainer(document, selected);
  const existing = container.querySelector<HTMLElement>(':scope > [data-editor-free-layer="true"]');
  if (existing) return existing;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const layer = document.createElement('div');
  layer.dataset.editorNew = crypto.randomUUID();
  layer.dataset.editorKind = 'free-layer';
  layer.dataset.editorFreeLayer = 'true';
  layer.style.cssText = 'position:absolute;inset:0;min-width:100%;min-height:100%;pointer-events:none;z-index:1000;overflow:visible;';
  container.append(layer);
  return layer;
}

export function prepareAbsolute(element: HTMLElement, container: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const parentRect = container.getBoundingClientRect();
  const scale = editorScale(container);
  const computed = getComputedStyle(container);
  if (computed.position === 'static') container.style.position = 'relative';
  element.style.position = 'absolute';
  element.style.left = `${Math.round((rect.left - parentRect.left) / scale.x)}px`;
  element.style.top = `${Math.round((rect.top - parentRect.top) / scale.y)}px`;
  element.style.width = `${Math.round(rect.width / scale.x)}px`;
  element.style.height = `${Math.round(rect.height / scale.y)}px`;
  element.style.margin = '0px';
}

export function editorScale(container: HTMLElement): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return {
    x: container.offsetWidth ? rect.width / container.offsetWidth : 1,
    y: container.offsetHeight ? rect.height / container.offsetHeight : 1,
  };
}

export function showAlignmentGrid(container: HTMLElement): void {
  if (container.querySelector(':scope > .editor-alignment-grid')) return;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const grid = container.ownerDocument.createElement('div');
  grid.className = 'editor-alignment-grid';
  grid.setAttribute('aria-hidden', 'true');
  grid.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483000;background-image:radial-gradient(circle,rgba(71,85,105,.58) 0 0.7px,transparent 0.9px);background-size:10px 10px;background-position:5px 5px;box-shadow:inset 0 0 0 1px rgba(71,85,105,.22);';
  container.append(grid);
}

export function hideAlignmentGrid(document: Document): void {
  document.querySelectorAll('.editor-alignment-grid').forEach((element) => element.remove());
}

export function cloneEditorElementForReuse(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('[data-editor-text-owner]').forEach((fragment) => fragment.replaceWith(fragment.ownerDocument.createTextNode(fragment.textContent ?? '')));
  const all = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  for (const item of all) {
    const selectable = item.hasAttribute('data-editor-id') || item.hasAttribute('data-editor-new');
    item.removeAttribute('id');
    item.removeAttribute('data-editor-id');
    item.removeAttribute('data-editor-new');
    item.removeAttribute('data-editor-restricted');
    item.removeAttribute('data-editor-restricted-reason');
    item.removeAttribute('data-editor-deck-slide');
    item.removeAttribute('data-editor-current-slide');
    item.removeAttribute('data-editor-grid-visible');
    item.removeAttribute('data-editor-source-consumed');
    item.removeAttribute('data-editor-detached');
    item.removeAttribute('contenteditable');
    item.classList.remove('editor-selected', 'editor-resize-handle', 'editor-alignment-grid');
    if (selectable) item.dataset.editorNew = crypto.randomUUID();
  }
  if (!clone.dataset.editorNew) clone.dataset.editorNew = crypto.randomUUID();
  clone.dataset.editorFreePosition = 'true';
  return clone;
}

export function detachFlowElementForMove(document: Document, element: HTMLElement, container: HTMLElement): HTMLElement {
  if (element.closest('[data-editor-free-layer="true"]') || element.dataset.editorDetached === 'true') return element;
  const position = getComputedStyle(element).position;
  if (position === 'absolute' || position === 'fixed') return element;
  const rect = element.getBoundingClientRect();
  const placeholder = element.cloneNode(true) as HTMLElement;
  for (const item of [placeholder, ...placeholder.querySelectorAll<HTMLElement>('*')]) {
    item.removeAttribute('id');
    for (const attribute of [...item.attributes]) {
      if (attribute.name.startsWith('data-editor-')) item.removeAttribute(attribute.name);
    }
    item.removeAttribute('contenteditable');
    item.classList.remove('editor-selected');
  }
  placeholder.dataset.editorNew = crypto.randomUUID();
  placeholder.dataset.editorKind = 'flow-placeholder';
  placeholder.dataset.editorFlowPlaceholder = 'true';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.setAttribute('inert', '');
  // Imported decks frequently reveal animated elements with author-level
  // `!important` rules. Inline priorities keep this layout placeholder truly
  // invisible while it continues to reserve the source element's flow space.
  placeholder.style.setProperty('visibility', 'hidden', 'important');
  placeholder.style.setProperty('opacity', '0', 'important');
  placeholder.style.setProperty('pointer-events', 'none', 'important');
  element.before(placeholder);
  const offsetParent = (element.offsetParent as HTMLElement | null) ?? container;
  const parentRect = offsetParent.getBoundingClientRect();
  const scale = editorScale(offsetParent);
  if (getComputedStyle(offsetParent).position === 'static') offsetParent.style.position = 'relative';
  element.dataset.editorDetached = 'true';
  element.style.position = 'absolute';
  element.style.left = `${Math.round((rect.left - parentRect.left) / scale.x)}px`;
  element.style.top = `${Math.round((rect.top - parentRect.top) / scale.y)}px`;
  element.style.width = `${Math.round(rect.width / scale.x)}px`;
  element.style.height = `${Math.round(rect.height / scale.y)}px`;
  element.style.margin = '0px';
  element.style.pointerEvents = 'auto';
  return element;
}

// Shapes and tables can carry text, but they are not *text elements*: they keep
// the object inspector (fill, border, structure) and edit their text through
// the shape/cell double-click path instead.
export const SHAPE_KINDS_WITH_TEXT = ['rectangle', 'rounded', 'ellipse', 'triangle', 'arrow'];

export function isTextElement(element: HTMLElement | null): element is HTMLElement {
  if (!element || element.tagName === 'IMG' || ['rectangle', 'rounded', 'ellipse', 'line', 'arrow', 'triangle', 'decoration', 'free-layer', 'flow-placeholder', 'table'].includes(element.dataset.editorKind ?? '')) return false;
  if (element.dataset.editorKind === 'text') return true;
  return Boolean((element.textContent ?? '').trim()) && !['SVG', 'CANVAS', 'VIDEO', 'AUDIO'].includes(element.tagName);
}

function colorToHex(value: string): string {
  const short = /^#([\da-f]{3})$/i.exec(value);
  if (short) return `#${[...short[1]].map((part) => part + part).join('')}`.toUpperCase();
  const full = /^#[\da-f]{6}$/i.exec(value);
  if (full) return value.toUpperCase();
  const rgb = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!rgb || rgb.length !== 3) return '#000000';
  return `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function readTextStyle(element: HTMLElement): TextInspectorStyle {
  const computed = getComputedStyle(element);
  const fontSize = Number.parseFloat(computed.fontSize) || 16;
  const computedLine = Number.parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(computedLine) ? computedLine / fontSize : 1.2;
  const alignment = computed.textAlign;
  return {
    fontSize: Math.round(fontSize * 100) / 100,
    fontFamily: element.style.fontFamily || computed.fontFamily,
    fontWeight: String(Number.parseInt(computed.fontWeight, 10) || 400),
    textAlign: alignment === 'center' || alignment === 'right' ? alignment : 'left',
    lineHeight: Math.max(0.8, Math.min(3, Math.round(lineHeight * 100) / 100)),
    color: colorToHex(computed.color),
  };
}

export function documentFontFamilies(document: Document): string[] {
  const families = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')) {
    const value = element.style.fontFamily || getComputedStyle(element).fontFamily;
    if (value) families.add(value);
  }
  return [...families];
}
