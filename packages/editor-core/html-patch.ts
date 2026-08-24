import * as parse5 from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { EditableDocument, EditableElement, PatchOperation } from './types.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

const skipped = new Set(['html', 'head', 'meta', 'link', 'style', 'script', 'title', 'base']);

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function walk(node: Node, visit: (element: Element) => void): void {
  if (isElement(node)) visit(node);
  if ('childNodes' in node) for (const child of node.childNodes) walk(child, visit);
}

export function inspectHtml(source: string): EditableDocument {
  const document = parse5.parse(source, { sourceCodeLocationInfo: true });
  const elements: EditableElement[] = [];
  let index = 0;
  walk(document, (element) => {
    const location = element.sourceCodeLocation;
    if (!location || !location.startTag || skipped.has(element.tagName)) return;
    const attrs = Object.fromEntries(element.attrs.map((item) => [item.name, item.value]));
    const directTextFragments = element.childNodes
      .filter((child) => child.nodeName === '#text' && child.sourceCodeLocation)
      .map((child: any, fragmentIndex) => ({
        index: fragmentIndex,
        startOffset: child.sourceCodeLocation.startOffset,
        endOffset: child.sourceCodeLocation.endOffset,
        text: child.value,
      }));
    const directText = directTextFragments.map((fragment) => fragment.text).join('');
    elements.push({
      id: `e${++index}`,
      tagName: element.tagName,
      startOffset: location.startOffset,
      startTagEndOffset: location.startTag.endOffset,
      endTagStartOffset: location.endTag?.startOffset ?? null,
      endOffset: location.endOffset,
      attributes: attrs,
      directText,
      directTextFragments,
      hasElementChildren: element.childNodes.some((child) => isElement(child)),
    });
  });
  const scriptBlocks = [...source.matchAll(/<script\b[\s\S]*?<\/script\s*>/gi)].map((match) => match[0]);
  return { html: source, elements, scriptBlocks };
}

type Replacement = { start: number; end: number; value: string };

function replaceAttribute(startTag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const replacement = ` ${name}="${escapeAttribute(value)}"`;
  if (pattern.test(startTag)) return startTag.replace(pattern, replacement);
  return startTag.replace(/\s*\/?\s*>$/, `${replacement}>`);
}

export function applyPatches(source: string, operations: PatchOperation[]): string {
  const inspected = inspectHtml(source);
  const byId = new Map(inspected.elements.map((element) => [element.id, element]));
  const replacements: Replacement[] = [];

  for (const operation of operations) {
    if (operation.type === 'replaceSpeakerNotes') continue;
    if (operation.type === 'insertElement') {
      const parent = byId.get(operation.parentId);
      if (!parent?.endTagStartOffset) throw new Error(`找不到可插入的父元素：${operation.parentId}`);
      replacements.push({ start: parent.endTagStartOffset, end: parent.endTagStartOffset, value: operation.html });
      continue;
    }
    const target = byId.get(operation.id);
    if (!target) throw new Error(`找不到編輯元素：${operation.id}`);
    if (operation.type === 'deleteElement') {
      replacements.push({ start: target.startOffset, end: target.endOffset, value: '' });
    } else if (operation.type === 'replaceChildren') {
      if (target.endTagStartOffset === null) throw new Error('此元素不能替換子內容。');
      replacements.push({ start: target.startTagEndOffset, end: target.endTagStartOffset, value: operation.html });
    } else if (operation.type === 'replaceInnerHtml') {
      if (target.endTagStartOffset === null) throw new Error('此元素不能套用局部富文字。');
      replacements.push({ start: target.startTagEndOffset, end: target.endTagStartOffset, value: operation.value });
    } else if (operation.type === 'replaceTextFragment') {
      const fragment = target.directTextFragments.find((item) => item.index === operation.fragmentIndex);
      if (!fragment) throw new Error(`找不到文字片段：${operation.id}/${operation.fragmentIndex}`);
      replacements.push({ start: fragment.startOffset, end: fragment.endOffset, value: escapeText(operation.value) });
    } else if (operation.type === 'replaceText') {
      if (target.endTagStartOffset === null) throw new Error('此元素無法直接修改文字。');
      replacements.push({ start: target.startTagEndOffset, end: target.endTagStartOffset, value: operation.value });
    } else {
      const startTag = source.slice(target.startOffset, target.startTagEndOffset);
      const name = operation.type === 'setStyle' ? 'style' : operation.name;
      replacements.push({
        start: target.startOffset,
        end: target.startTagEndOffset,
        value: replaceAttribute(startTag, name, operation.value),
      });
    }
  }

  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const replacement of replacements) {
    if (replacement.end > lastStart) throw new Error('編輯操作互相重疊，已停止匯出以避免損壞。');
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
    lastStart = replacement.start;
  }
  return result;
}

export function makeEditableHtml(source: string, baseHref: string): EditableDocument {
  const inspected = inspectHtml(source);
  const replacements: Replacement[] = inspected.elements.map((element) => ({
    start: element.startTagEndOffset - 1,
    end: element.startTagEndOffset - 1,
    value: ` data-editor-id="${element.id}"`,
  }));
  for (const element of inspected.elements) {
    if (!element.hasElementChildren) continue;
    for (const fragment of element.directTextFragments.filter((item) => item.text.trim())) {
      const original = encodeURIComponent(fragment.text);
      replacements.push({
        start: fragment.startOffset,
        end: fragment.endOffset,
        value: `<span data-editor-text-owner="${element.id}" data-editor-text-index="${fragment.index}" data-editor-text-original="${escapeAttribute(original)}">${source.slice(fragment.startOffset, fragment.endOffset)}</span>`,
      });
    }
  }
  const scriptLocations = [...source.matchAll(/<script\b/gi)].map((match) => match.index! + '<script'.length);
  for (const offset of scriptLocations) replacements.push({ start: offset, end: offset, value: ' type="text/plain" data-editor-disabled="true"' });
  const headStart = /<head(?:\s[^>]*)?>/i.exec(source);
  const injectionOffset = headStart ? headStart.index + headStart[0].length : 0;
  const security = `<base href="${escapeAttribute(baseHref)}"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'">`;
  replacements.push({ start: injectionOffset, end: injectionOffset, value: security });
  replacements.sort((a, b) => b.start - a.start);
  let html = source;
  for (const replacement of replacements) html = html.slice(0, replacement.start) + replacement.value + html.slice(replacement.end);
  return { ...inspected, html };
}

export function sanitizeInsertedHtml(html: string): string {
  if (/<(?:script|iframe|object|embed|form)\b/i.test(html) || /\son\w+\s*=/i.test(html)) {
    throw new Error('插入內容包含不允許的標籤或事件。');
  }
  return html.replace(/\sdata-editor-(?:id|new)="[^"]*"/g, '').replace(/\scontenteditable="[^"]*"/g, '');
}

export function sanitizeRichTextHtml(html: string): string {
  if (/<(?:script|iframe|object|embed|form|style|link|meta|base)\b/i.test(html) || /\son\w+\s*=/i.test(html)) {
    throw new Error('富文字內容包含不允許的標籤或事件。');
  }
  return html
    .replace(/\s(?:src|href)\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
    .replace(/\scontenteditable="[^"]*"/g, '')
    .replace(/\sdata-editor-(?:id|new|selected)="[^"]*"/g, '');
}
