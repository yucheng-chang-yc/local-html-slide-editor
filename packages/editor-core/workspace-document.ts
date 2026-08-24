import { applyPatches, inspectHtml, sanitizeInsertedHtml, sanitizeRichTextHtml } from './html-patch.js';
import { maskSpeakerNotes, replaceSpeakerNotes } from './speaker-notes.js';
import type { CompatibilityReport, EditableElement, PatchOperation, RestrictedElement } from './types.js';

export function applyWorkspaceDocument(source: string, operations: PatchOperation[]): string {
  const sanitized = operations.map((operation) => operation.type === 'insertElement'
    ? { ...operation, html: sanitizeInsertedHtml(operation.html) }
    : operation.type === 'replaceInnerHtml'
      ? { ...operation, value: sanitizeRichTextHtml(operation.value) }
      : operation);
  const noteOperation = [...sanitized].reverse().find((operation): operation is Extract<PatchOperation, { type: 'replaceSpeakerNotes' }> => operation.type === 'replaceSpeakerNotes');
  const documentOperations = sanitized.filter((operation) => operation.type !== 'replaceSpeakerNotes');
  let output = applyPatches(source, documentOperations);
  if (JSON.stringify(inspectHtml(source).scriptBlocks) !== JSON.stringify(inspectHtml(output).scriptBlocks)) {
    throw new Error('來源 script 驗證失敗，已停止寫入。');
  }
  if (noteOperation) {
    if (noteOperation.notes.length > 500 || noteOperation.notes.some((note) => note.length > 200_000)) throw new Error('講者備註內容超出安全限制。');
    output = replaceSpeakerNotes(output, noteOperation.notes);
    if (JSON.stringify(inspectHtml(maskSpeakerNotes(source)).scriptBlocks) !== JSON.stringify(inspectHtml(maskSpeakerNotes(output)).scriptBlocks)) {
      throw new Error('講者備註以外的來源 script 發生變更，已停止寫入。');
    }
  }
  return output;
}

function riskRoot(element: EditableElement): boolean {
  if (element.attributes['data-editor-free-position'] === 'true') return false;
  const identity = `${element.attributes.class ?? ''} ${element.attributes.id ?? ''}`;
  return /(?:nested[-_ ]?transform|transformed|transform-risk)/i.test(identity)
    || /(?:^|;)\s*transform\s*:\s*(?!none\b)/i.test(element.attributes.style ?? '');
}

export function classifyCompatibility(html: string): CompatibilityReport {
  const inspected = inspectHtml(html);
  const reasons: string[] = [];
  const documentReasons: string[] = [];
  const runtimeControlled = /\b(?:ReactDOM|createRoot|createApp|hydrateRoot)\s*\(|\b(?:ng-app|data-reactroot)\b/i.test(html);
  const shadowControlled = /attachShadow\s*\(|<slot\b/i.test(html);
  const hasCanvas = /<canvas\b/i.test(html);
  const meaningfulStatic = inspected.elements.some((element) =>
    !['body', 'main', 'section', 'div', 'canvas'].includes(element.tagName)
    && (Boolean(element.directText.trim()) || ['img', 'svg'].includes(element.tagName)));
  if (runtimeControlled) documentReasons.push('偵測到 runtime framework 控制 DOM，無法保證來源序列化安全');
  if (shadowControlled) documentReasons.push('偵測到 Shadow DOM／slot runtime 結構，無法隔離可寫回來源');
  if (hasCanvas && !meaningfulStatic) documentReasons.push('文件為 canvas-only rendering，沒有可安全映射的靜態文字或圖片元素');
  const restricted = new Map<string, RestrictedElement>();
  for (const root of inspected.elements.filter(riskRoot)) {
    for (const element of inspected.elements) {
      if (element.startOffset < root.startOffset || element.endOffset > root.endOffset) continue;
      restricted.set(element.id, { id: element.id, operations: ['drag', 'resize'], reason: '此元素位於 nested transform 子樹；直接拖拉或縮放可能破壞座標系。可先轉為自由定位。' });
    }
  }
  const commonLayout = /display\s*:\s*(?:flex|grid)|@media\b|\b(?:class|id)\s*=\s*["'][^"']*(?:flow|responsive|grid|flex)[^"']*["']/i.test(html);
  if (commonLayout) reasons.push('偵測到一般 flow／flex／grid／responsive 版面；安全編輯與自由插入保持可用');
  if (restricted.size) reasons.push(`nested transform 限制僅套用於 ${restricted.size} 個受影響元素的拖拉／縮放`);
  if (hasCanvas && meaningfulStatic) reasons.push('canvas 本身不可編輯；其餘靜態 DOM 保持可用');
  const documentReadOnly = documentReasons.length > 0;
  return {
    level: documentReadOnly ? 'READ_ONLY' : restricted.size ? 'MIXED' : 'SUPPORTED',
    reasons: documentReadOnly ? documentReasons : reasons,
    documentReadOnly,
    restrictedElements: [...restricted.values()],
    elementClasses: [
      { kind: 'static-dom-text-image-shape', status: documentReadOnly ? 'UNSUPPORTED' : 'SUPPORTED' },
      { kind: 'ordinary-flow-flex-grid-responsive', status: documentReadOnly ? 'UNSUPPORTED' : 'SUPPORTED' },
      { kind: 'nested-transform-high-risk-operations', status: restricted.size ? 'LIMITED' : 'SUPPORTED' },
      { kind: 'canvas-shadow-dom-runtime-controlled', status: documentReadOnly ? 'UNSUPPORTED' : 'LIMITED' },
    ],
  };
}
