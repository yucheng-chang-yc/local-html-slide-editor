import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  buildOperations,
  captureBaseline,
  cleanRuntimeDecorations,
  cloneEditorElementForReuse,
  createEditorDeckController,
  detachFlowElementForMove,
  documentFontFamilies,
  editorScale,
  freePositionLayer,
  hideAlignmentGrid,
  installEditableDecorations,
  isTextElement,
  SHAPE_KINDS_WITH_TEXT,
  prepareAbsolute,
  promoteEditableDecoration,
  readTextStyle,
  selectedContainer,
  showAlignmentGrid,
  type BaselineElement,
  type EditorDeckController,
  type TextInspectorStyle,
} from './editor';
import { deleteWorkspace, exportProject, getStorageDiagnostics, importFile, listSnapshots, loadLastSession, printProject, requestPersistentStorage, restoreWorkspace, runtimeMode, saveDraft, uploadAsset, type StorageDiagnostics, type WorkspacePayload } from './api';
import { applyElementTransform, installInteractionLayer } from './interaction';
import { commandRegistry, type CommandId } from './commands';
import {
  ContextualCommandBar,
  FieldGrid,
  GlobalBar,
  InspectorSection,
  InspectorShell,
  SlideRail,
  type CommandContext,
  type ShellViewport,
  type SlideSummary,
} from './shell';
import type { PatchOperation } from '../../../packages/editor-core/types';
import {
  IconAddPage, IconAlign, IconArrow, IconBackgroundImage, IconCopy, IconDelete, IconDeletePage,
  IconDuplicate, IconEllipse, IconExport, IconFitSlide, IconFitWidth, IconFormatPainter, IconGrid, IconGroup, IconGuides,
  IconImage, IconImportZip, IconLayers, IconLine, IconMoveDown, IconMoveUp, IconNotes,
  IconOpen, IconPaste, IconPresenter, IconPreview, IconPrint, IconRatio, IconRectangle, IconRedo, IconRestore,
  IconRoundedRect, IconStorage, IconTable, IconTextBox, IconTriangle, IconUndo, IconUnlock,
} from './icons';

type Notice = { type: 'info' | 'error'; text: string };
type ClipboardItem = { html: string; left: number; top: number; width: number; height: number };
type HistoryState = { body: string; notes: string[] | null; slideIndex: number };
const commonSizes = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80];
const fontChoices = [
  { label: '系統無襯線', value: 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif' },
  { label: '系統襯線', value: 'Georgia, "Times New Roman", "PMingLiU", serif' },
  { label: '系統等寬', value: 'Consolas, "SFMono-Regular", monospace' },
  { label: '微軟正黑體', value: '"Microsoft JhengHei", "PingFang TC", sans-serif' },
  { label: '標楷體', value: 'DFKai-SB, BiauKai, "Microsoft JhengHei", serif' },
  { label: '新細明體', value: 'PMingLiU, "Songti TC", serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
];
const weights = [{ label: '細', value: '300' }, { label: '標準', value: '400' }, { label: '粗', value: '700' }, { label: '超粗', value: '900' }];
const alignments = [{ label: '左對齊', value: 'left' }, { label: '置中', value: 'center' }, { label: '右對齊', value: 'right' }] as const;
const palette = [
  '#000000', '#FFFFFF', '#334155', '#64748B', '#94A3B8', '#E2E8F0',
  '#7F1D1D', '#DC2626', '#F97316', '#F59E0B', '#FACC15', '#65A30D',
  '#15803D', '#059669', '#0F766E', '#0891B2', '#2563EB', '#4F46E5',
  '#7C3AED', '#A21CAF', '#DB2777', '#BE123C', '#78350F', '#1E3A8A',
];
const formatBytes = (value: number | null) => value === null ? '未知' : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const LAST_EXPORT_STORAGE_KEY = 'html-editor-last-export';
const formatRelativeTime = (iso: string | null) => {
  if (!iso) return '從未匯出';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.round(hours / 24)} 天前`;
};
const isExportStale = (iso: string | null) => !iso || Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000;
const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

// <input type="color"> only accepts #rrggbb, but inline styles come back as
// rgb()/#rgb depending on how the deck was authored.
const toHexColor = (value: string | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim();
  const short = /^#([\da-f]{3})$/i.exec(trimmed);
  if (short) return `#${[...short[1]].map((part) => part + part).join('')}`.toLowerCase();
  if (/^#[\da-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const channels = trimmed.match(/^rgba?\(([^)]+)\)$/i)?.[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  if (channels?.length === 3 && channels.every((channel) => Number.isFinite(channel))) {
    return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
  }
  return fallback;
};

type LayerItem = { key: string; label: string };
const shapeLabels: Record<string, string> = { rectangle: '矩形', rounded: '圓角矩形', ellipse: '橢圓', line: '線條', arrow: '箭頭', triangle: '三角形', decoration: '裝飾條' };
const layerLabel = (element: HTMLElement): string => {
  const kind = element.dataset.editorKind;
  if (kind === 'group') return '群組';
  if (element.tagName === 'IMG') return '圖片';
  if (isTextElement(element)) return (element.textContent ?? '').trim().slice(0, 24) || '文字方塊';
  return shapeLabels[kind ?? ''] ?? '物件';
};
const layerKey = (element: HTMLElement) => element.dataset.editorId ?? element.dataset.editorNew ?? '';

export function App() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview' | 'presenter'>('edit');
  const [notice, setNotice] = useState<Notice>({ type: 'info', text: '請開啟 HTML 或匯入 ZIP 開始編輯。' });
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [selectedTextCount, setSelectedTextCount] = useState(0);
  const [textStyle, setTextStyle] = useState<TextInspectorStyle | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState('#000000');
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [restrictedReason, setRestrictedReason] = useState<string | null>(null);
  const [editorDeckPosition, setEditorDeckPosition] = useState<{ current: number; total: number } | null>(null);
  const [speakerNotes, setSpeakerNotes] = useState<string[] | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [presenterIndex, setPresenterIndex] = useState(0);
  const [presenterElapsedMs, setPresenterElapsedMs] = useState(0);
  const [slideSummaries, setSlideSummaries] = useState<SlideSummary[]>([]);
  const [ribbonTab, setRibbonTab] = useState<'home' | 'insert' | 'arrange' | 'view'>('home');
  const [inspectorTab, setInspectorTab] = useState<'format' | 'position'>('format');
  const [zoom, setZoom] = useState(100);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [guidesEnabled, setGuidesEnabled] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(188);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 1100);
  const [viewportMode, setViewportMode] = useState<ShellViewport>(() => window.innerWidth <= 820 ? 'drawer' : window.innerWidth <= 1100 ? 'compact' : 'desktop');
  const [autosaveState, setAutosaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [snapshots, setSnapshots] = useState<Array<{ id: string; createdAt: string }>>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [storageDiagnostics, setStorageDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [storagePanelOpen, setStoragePanelOpen] = useState(false);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(() => localStorage.getItem(LAST_EXPORT_STORAGE_KEY));
  const [layersOpen, setLayersOpen] = useState(false);
  const [layerItems, setLayerItems] = useState<LayerItem[]>([]);
  const [hasCopiedFormat, setHasCopiedFormat] = useState(false);
  const presenterStartRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const imagePurposeRef = useRef<'object' | 'background'>('object');
  const baselineRef = useRef(new Map<string, BaselineElement>());
  const selectedRef = useRef<HTMLElement[]>([]);
  const undoRef = useRef<HistoryState[]>([]);
  const redoRef = useRef<HistoryState[]>([]);
  const editingBeforeRef = useRef<string | null>(null);
  const lineBeforeRef = useRef<string | null>(null);
  const editorDeckRef = useRef<EditorDeckController | null>(null);
  const clipboardRef = useRef<ClipboardItem[]>([]);
  const formatClipboardRef = useRef<Record<string, string> | null>(null);
  const pasteOffsetRef = useRef(0);
  const originalSpeakerNotesRef = useRef<string[] | null>(null);
  const speakerNotesRef = useRef<string[] | null>(null);
  const notesBeforeRef = useRef<string[] | null>(null);
  const richRangeRef = useRef<Range | null>(null);
  const interactionRef = useRef<{ render: () => void; destroy: () => void } | null>(null);
  const gridEnabledRef = useRef(gridEnabled);
  const guidesEnabledRef = useRef(guidesEnabled);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveCurrentDraftRef = useRef<() => Promise<void>>(async () => undefined);
  const fitCanvasRef = useRef<(kind: 'slide' | 'width') => void>(() => undefined);
  const railPanelToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorPanelToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    gridEnabledRef.current = gridEnabled;
    const document = iframeRef.current?.contentDocument;
    if (!document) return;
    hideAlignmentGrid(document);
    if (!gridEnabled) return;
    const slide = document.querySelector<HTMLElement>('[data-editor-deck-slide="true"][data-editor-current-slide="true"]')
      ?? document.querySelector<HTMLElement>('[data-editor-current-slide="true"]')
      ?? selectedContainer(document, null);
    showAlignmentGrid(slide);
  }, [gridEnabled]);
  useEffect(() => { guidesEnabledRef.current = guidesEnabled; }, [guidesEnabled]);

  const doc = () => iframeRef.current?.contentDocument ?? null;
  function syncPersistentGrid(): void {
    const document = doc();
    if (!document) return;
    hideAlignmentGrid(document);
    if (!gridEnabled) return;
    const activeSlide = document.querySelector<HTMLElement>('[data-editor-deck-slide="true"][data-editor-current-slide="true"]')
      ?? document.querySelector<HTMLElement>('[data-editor-current-slide="true"]')
      ?? selectedContainer(document, null);
    showAlignmentGrid(activeSlide);
  }
  const snapshot = () => {
    const body = doc()?.body;
    if (!body) return '';
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.editor-interaction-layer,.editor-selection-box,.editor-marquee,.editor-smart-guide,.editor-alignment-grid').forEach((element) => element.remove());
    clone.querySelectorAll('.editor-selected').forEach((element) => element.classList.remove('editor-selected'));
    clone.querySelectorAll('[contenteditable="true"]').forEach((element) => element.setAttribute('contenteditable', 'false'));
    cleanRuntimeDecorations(clone);
    return clone.innerHTML;
  };
  const historySnapshot = (body = snapshot(), notes = speakerNotesRef.current): HistoryState => ({
    body,
    notes: notes ? [...notes] : null,
    slideIndex: editorDeckRef.current?.currentIndex ?? 0,
  });
  const updateSpeakerNotes = (notes: string[] | null) => {
    speakerNotesRef.current = notes ? [...notes] : null;
    setSpeakerNotes(notes ? [...notes] : null);
  };

  useEffect(() => {
    void loadLastSession().then((loaded) => {
      if (!loaded) return;
      setWorkspace((current) => current ?? loaded);
      originalSpeakerNotesRef.current = loaded.speakerNotes ? [...loaded.speakerNotes] : null;
      updateSpeakerNotes(loaded.speakerNotes ? [...loaded.speakerNotes] : null);
      setNotice({ type: 'info', text: '已恢復上次工作階段；原始匯入檔仍保持不變。' });
      void listSnapshots(loaded.id).then(setSnapshots);
    }).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : '無法恢復瀏覽器工作區；請重新匯入 HTML／ZIP 備份。' }));
    return () => { if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current); };
  }, []);

  const refreshStorageDiagnostics = () => void getStorageDiagnostics().then(setStorageDiagnostics).catch(() => undefined);

  useEffect(() => { refreshStorageDiagnostics(); }, [workspace?.id, autosaveState]);

  useEffect(() => {
    const closeMenus = () => document.querySelectorAll<HTMLDetailsElement>('.command-menu[open]').forEach((menu) => menu.removeAttribute('open'));
    const onPointerDown = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.command-menu')) closeMenus(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenus(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      const next: ShellViewport = window.innerWidth <= 820 ? 'drawer' : window.innerWidth <= 1100 ? 'compact' : 'desktop';
      setViewportMode((current) => {
        if (current === next) return current;
        setRailDrawerOpen(false);
        setInspectorOpen(next === 'desktop');
        setRailCollapsed(next === 'compact');
        return next;
      });
      fitCanvasRef.current('width');
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    if (mode !== 'presenter') return;
    const timer = window.setInterval(() => setPresenterElapsedMs(Date.now() - presenterStartRef.current), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (inspectorOpen && viewportMode !== 'desktop') {
        setInspectorOpen(false);
        inspectorPanelToggleRef.current?.focus();
      } else if (railDrawerOpen) {
        setRailDrawerOpen(false);
        railPanelToggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [inspectorOpen, railDrawerOpen, viewportMode]);

  const syncInspector = (elements: HTMLElement[]) => {
    const textElements = elements.filter((element) => isTextElement(element));
    const target = textElements[0] ?? null;
    setSelectedTextCount(textElements.length);
    const reason = target?.dataset.editorRestrictedReason ?? null;
    setRestrictedReason(reason);
    if (!isTextElement(target)) {
      setTextStyle(null);
      setFontFamilies([]);
      return;
    }
    const style = readTextStyle(target);
    setTextStyle(style);
    setColorDraft(style.color);
    setFontFamilies(documentFontFamilies(target.ownerDocument));
  };

  const initializeEditorDeck = (document: Document, preferredIndex?: number) => {
    hideAlignmentGrid(document);
    const controller = createEditorDeckController(document);
    if (controller && preferredIndex !== undefined) controller.show(preferredIndex);
    editorDeckRef.current = controller;
    setEditorDeckPosition(controller ? { current: controller.currentIndex, total: controller.slideCount } : null);
    const slides = [...document.querySelectorAll<HTMLElement>('.slide,[data-slide]')]
      .filter((element) => !element.parentElement?.closest('.slide,[data-slide]'));
    const previewHead = [...document.head.children]
      .filter((node) => !node.matches('script,style[data-editor-runtime]'))
      .map((node) => node.outerHTML)
      .join('');
    setSlideSummaries(slides.map((slide, index) => {
      const previewSlide = slide.cloneNode(true) as HTMLElement;
      cleanRuntimeDecorations(previewSlide);
      previewSlide.querySelectorAll('.editor-selected').forEach((element) => element.classList.remove('editor-selected'));
      return {
        key: slide.dataset.editorId ?? slide.dataset.editorNew ?? String(index),
        title: slide.dataset.title || slide.getAttribute('aria-label') || `第 ${index + 1} 頁`,
        index,
        preview: `<!doctype html><html><head>${previewHead}<style>html,body{margin:0!important;width:1600px!important;height:900px!important;overflow:hidden!important;background:#fff!important}.slide,[data-slide]{display:block!important;visibility:visible!important;opacity:1!important;transform:none!important;transform-origin:top left!important;position:relative!important;inset:auto!important;margin:0!important;width:1600px!important;height:900px!important}.slide .reveal,.slide [data-frag],[data-slide] .reveal,[data-slide] [data-frag]{visibility:visible!important;opacity:1!important;transform:none!important}</style></head><body>${previewSlide.outerHTML}</body></html>`,
      };
    }));
    if (gridEnabledRef.current) {
      const activeSlide = document.querySelector<HTMLElement>('[data-editor-deck-slide="true"][data-editor-current-slide="true"]')
        ?? document.querySelector<HTMLElement>('[data-editor-current-slide="true"]')
        ?? selectedContainer(document, null);
      showAlignmentGrid(activeSlide);
    }
    setLayerItems(computeLayerItems(document, selectedRef.current));
    return controller;
  };

  const refreshSelection = (elements: HTMLElement[]) => {
    const ownerDocument = elements[0]?.ownerDocument ?? selectedRef.current[0]?.ownerDocument;
    ownerDocument?.querySelectorAll('.editor-selected').forEach((item) => item.classList.remove('editor-selected'));
    selectedRef.current = elements;
    elements.forEach((item) => item.classList.add('editor-selected'));
    setSelectedCount(elements.length);
    setSelectionEpoch((value) => value + 1);
    syncInspector(elements);
    if (elements.length && viewportMode === 'desktop') setInspectorOpen(true);
    queueMicrotask(() => interactionRef.current?.render());
    if (ownerDocument) setLayerItems(computeLayerItems(ownerDocument, elements));
  };

  const clearSelection = () => {
    refreshSelection([]);
    doc()?.querySelector('.editor-resize-handle')?.remove();
  };

  const commit = (before: string, preserveSelection = true, notesBefore = speakerNotesRef.current) => {
    const notesChanged = JSON.stringify(notesBefore) !== JSON.stringify(speakerNotesRef.current);
    if (before !== snapshot() || notesChanged) {
      undoRef.current.push(historySnapshot(before, notesBefore));
      redoRef.current = [];
    }
    const kept = preserveSelection ? selectedRef.current.filter((element) => element.isConnected) : [];
    refreshSelection(kept);
    const document = doc();
    if (document) {
      updateResizeHandle(document);
      initializeEditorDeck(document, editorDeckRef.current?.currentIndex);
    }
    setAutosaveState('saving');
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => void saveCurrentDraftRef.current(), 700);
  };

  const updateResizeHandle = (document: Document) => {
    void document;
    interactionRef.current?.render();
  };

  const bindEditor = () => {
    const document = doc();
    if (!document || mode !== 'edit' || !workspace) return;
    refreshSelection([]);
    const style = document.createElement('style');
    style.textContent = `[data-editor-id],[data-editor-new]{cursor:pointer}[data-editor-text-owner]{cursor:text}[data-editor-free-layer=true]>*{pointer-events:auto}.deck-controls,[aria-label="簡報操作"]{display:none!important}.editor-selected{outline:2px solid #4776f6!important;outline-offset:2px}.editor-selected[data-editor-restricted=true]{outline-color:#f59e0b!important;outline-style:dashed!important}[contenteditable=true]{outline:2px solid #f59e0b!important}.editor-interaction-layer{position:absolute;inset:0;pointer-events:none;z-index:2147483640}.editor-selection-box{position:absolute;border:1.5px solid #4776f6;box-sizing:border-box;pointer-events:none}.editor-transform-handle,.editor-rotation-handle{position:absolute;width:12px;height:12px;border:2px solid #4776f6;background:white;border-radius:2px;box-shadow:0 1px 3px rgba(15,23,42,.28);pointer-events:auto;padding:0}.handle-nw{left:-7px;top:-7px;cursor:nwse-resize}.handle-n{left:calc(50% - 6px);top:-7px;cursor:ns-resize}.handle-ne{right:-7px;top:-7px;cursor:nesw-resize}.handle-e{right:-7px;top:calc(50% - 6px);cursor:ew-resize}.handle-se{right:-7px;bottom:-7px;cursor:nwse-resize}.handle-s{left:calc(50% - 6px);bottom:-7px;cursor:ns-resize}.handle-sw{left:-7px;bottom:-7px;cursor:nesw-resize}.handle-w{left:-7px;top:calc(50% - 6px);cursor:ew-resize}.editor-rotation-handle{left:calc(50% - 7px);top:-34px;border-radius:50%;cursor:grab}.editor-rotation-handle:after{content:'';position:absolute;left:4px;top:10px;width:1px;height:20px;background:#4776f6}.editor-marquee{position:absolute;background:rgba(71,118,246,.12);border:1px solid #4776f6;pointer-events:none}.editor-smart-guide{position:absolute;background:#f43f5e;z-index:2147483639;pointer-events:none}.editor-position-badge{position:fixed;padding:3px 7px;border-radius:4px;color:#fff;font:600 11px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;background:#1e2430;z-index:2147483641;pointer-events:none}`;
    document.head.append(style);
    const enhancedSelectionStyle = document.createElement('style');
    enhancedSelectionStyle.dataset.editorRuntime = 'enhanced-selection';
    enhancedSelectionStyle.textContent = `.editor-selected{outline:1px dashed rgba(71,118,246,.68)!important;outline-offset:2px}.editor-selection-box{border:2px solid #2563eb!important;box-shadow:0 0 0 2px rgba(37,99,235,.18);box-sizing:border-box}.editor-selection-box[data-selection-kind="multi"]{border-color:#7c3aed!important;box-shadow:0 0 0 3px rgba(124,58,237,.18)}.editor-selection-box[data-selection-kind="group"]{border-color:#0f766e!important;border-style:dashed!important;box-shadow:0 0 0 3px rgba(15,118,110,.18)}.editor-selection-badge{position:absolute;left:-2px;top:-25px;padding:3px 6px;border-radius:4px;background:#2563eb;color:#fff;font:600 11px system-ui;white-space:nowrap}.editor-selection-box[data-selection-kind="multi"] .editor-selection-badge{background:#7c3aed}.editor-selection-box[data-selection-kind="group"] .editor-selection-badge{background:#0f766e}`;
    document.head.append(enhancedSelectionStyle);
    document.documentElement.style.setProperty('zoom', String(zoom / 100));
    const editorDeck = initializeEditorDeck(document);
    if (baselineRef.current.size === 0) baselineRef.current = captureBaseline(document);
    syncPersistentGrid();
    interactionRef.current?.destroy();
    interactionRef.current = installInteractionLayer(document, {
      selected: () => selectedRef.current,
      select: refreshSelection,
      before: snapshot,
      commit: (before) => commit(before, true),
      notify: (text) => setNotice({ type: 'info', text }),
      gridEnabled: () => gridEnabledRef.current,
      guidesEnabled: () => guidesEnabledRef.current,
    });

    for (const restriction of workspace.compatibility.restrictedElements) {
      const element = document.querySelector<HTMLElement>(`[data-editor-id="${restriction.id}"]`);
      if (!element) continue;
      element.dataset.editorRestricted = 'true';
      element.dataset.editorRestrictedReason = restriction.reason;
    }
    if (workspace.compatibility.documentReadOnly) {
      setNotice({ type: 'error', text: `唯讀：${workspace.compatibility.reasons.join('；')}` });
      return;
    }

    installEditableDecorations(document);
    document.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]').forEach((element) => {
      if (element.matches('.slide,[data-slide]') || element.dataset.editorKind === 'free-layer' || element.hasAttribute('tabindex')) return;
      element.tabIndex = 0;
    });
    document.addEventListener('keydown', (event) => {
      if ((event.key !== 'Enter' && event.key !== ' ') || (event.target as HTMLElement).isContentEditable) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-id],[data-editor-new]');
      if (!target || target.matches('.slide,[data-slide]') || target.dataset.editorKind === 'free-layer' || target.classList.contains('editor-resize-handle')) return;
      event.preventDefault();
      const multi = event.ctrlKey || event.metaKey || event.shiftKey;
      const next = multi
        ? selectedRef.current.includes(target) ? selectedRef.current.filter((item) => item !== target) : [...selectedRef.current, target]
        : selectedRef.current.length > 1 && selectedRef.current.includes(target) ? selectedRef.current : [target];
      refreshSelection(next);
      updateResizeHandle(document);
    });
    document.addEventListener('pointerdown', (event) => {
      const proxy = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-runtime-decoration-proxy]');
      if (!proxy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const before = snapshot();
      const promoted = promoteEditableDecoration(proxy);
      if (!promoted) return;
      commit(before, false);
      refreshSelection([promoted]);
      promoted.focus({ preventScroll: true });
      setNotice({ type: 'info', text: '裝飾條已轉為可獨立移動、縮放與調色的物件；可使用復原還原。' });
    });

    document.addEventListener('pointerdown', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-id],[data-editor-new]');
      if (!target || target.matches('.slide,[data-slide]') || target.dataset.editorKind === 'free-layer' || target.classList.contains('editor-resize-handle') || target.isContentEditable) return;
      event.preventDefault();
      if (!target.hasAttribute('tabindex')) target.tabIndex = 0;
      target.focus({ preventScroll: true });
      const multi = event.ctrlKey || event.metaKey || event.shiftKey;
      const next = multi
        ? selectedRef.current.includes(target) ? selectedRef.current.filter((item) => item !== target) : [...selectedRef.current, target]
        : selectedRef.current.length > 1 && selectedRef.current.includes(target) ? selectedRef.current : [target];
      refreshSelection(next);
      updateResizeHandle(document);
      if (!next.length) return;
      const restricted = next.find((element) => element.dataset.editorRestricted === 'true');
      if (restricted) {
        setNotice({ type: 'error', text: restricted.dataset.editorRestrictedReason ?? '選取項目包含不可直接拖曳的高風險元素。' });
        return;
      }
      const before = snapshot();
      const container = selectedContainer(document, target);
      if (next.some((element) => selectedContainer(document, element) !== container)) {
        setNotice({ type: 'error', text: '跨頁元素不能一起拖曳。' });
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let starts: Array<{ element: HTMLElement; left: number; top: number; scale: { x: number; y: number } }> = [];
      let prepared = false;
      let moved = false;
      const move = (moveEvent: PointerEvent) => {
        if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 2) return;
        if (!prepared) {
          const moving = next.map((element) => detachFlowElementForMove(document, element, container));
          refreshSelection(moving);
          starts = moving.map((element) => {
            prepareAbsolute(element, container);
            const offsetParent = (element.offsetParent as HTMLElement | null) ?? container;
            return { element, left: Number.parseFloat(element.style.left), top: Number.parseFloat(element.style.top), scale: editorScale(offsetParent) };
          });
          prepared = true;
        }
        const snap = (value: number) => {
          if (moveEvent.altKey || !gridEnabledRef.current) return Math.round(value);
          const nearest = Math.round(value / 10) * 10;
          return Math.abs(nearest - value) <= 1 ? nearest : Math.round(value);
        };
        moved = true;
        for (const start of starts) {
          start.element.style.left = `${snap(start.left + (moveEvent.clientX - startX) / start.scale.x)}px`;
          start.element.style.top = `${snap(start.top + (moveEvent.clientY - startY) / start.scale.y)}px`;
        }
        document.querySelectorAll('.editor-smart-guide').forEach((guide) => guide.remove());
        document.querySelectorAll('.editor-position-badge').forEach((badge) => badge.remove());
        const badge = document.createElement('div');
        badge.className = 'editor-position-badge';
        badge.textContent = `${Math.round(Number.parseFloat(starts[0].element.style.left))}, ${Math.round(Number.parseFloat(starts[0].element.style.top))}`;
        badge.style.cssText = `left:${moveEvent.clientX + 14}px;top:${moveEvent.clientY + 14}px`;
        document.body.append(badge);
        if (guidesEnabledRef.current && !moveEvent.altKey) {
          const movingRects = starts.map(({ element }) => element.getBoundingClientRect());
          const left = Math.min(...movingRects.map((rect) => rect.left)); const right = Math.max(...movingRects.map((rect) => rect.right));
          const top = Math.min(...movingRects.map((rect) => rect.top)); const bottom = Math.max(...movingRects.map((rect) => rect.bottom));
          const movingX = [left, (left + right) / 2, right]; const movingY = [top, (top + bottom) / 2, bottom];
          const others = [...container.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
            .filter((element) => !starts.some((start) => start.element === element) && !element.matches('[data-editor-free-layer="true"],[data-editor-flow-placeholder="true"]'));
          const containerRect = container.getBoundingClientRect();
          const bodyRect = document.body.getBoundingClientRect();
          const bodyScale = editorScale(document.body);
          const bodyX = (value: number) => (value - bodyRect.left) / (bodyScale.x || 1);
          const bodyY = (value: number) => (value - bodyRect.top) / (bodyScale.y || 1);
          const guideX = [containerRect.left, containerRect.left + containerRect.width / 2, containerRect.right, ...others.flatMap((element) => { const r = element.getBoundingClientRect(); return [r.left, (r.left + r.right) / 2, r.right]; })];
          const guideY = [containerRect.top, containerRect.top + containerRect.height / 2, containerRect.bottom, ...others.flatMap((element) => { const r = element.getBoundingClientRect(); return [r.top, (r.top + r.bottom) / 2, r.bottom]; })];
          const match = (movingValues: number[], guides: number[]) => guides.flatMap((guide) => movingValues.map((value) => ({ guide, delta: guide - value }))).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
          const x = match(movingX, guideX); const y = match(movingY, guideY);
          const xActive = x && Math.abs(x.delta) <= 2 ? x : null;
          const yActive = y && Math.abs(y.delta) <= 2 ? y : null;
          if (xActive || yActive) {
            for (const start of starts) {
              if (xActive) start.element.style.left = `${Number.parseFloat(start.element.style.left) + xActive.delta / start.scale.x}px`;
              if (yActive) start.element.style.top = `${Number.parseFloat(start.element.style.top) + yActive.delta / start.scale.y}px`;
            }
          }
          if (xActive) {
            const line = document.createElement('div'); line.className = 'editor-smart-guide vertical'; line.style.cssText = `left:${bodyX(x.guide)}px;top:${bodyY(containerRect.top)}px;width:${1 / (bodyScale.x || 1)}px;height:${containerRect.height / (bodyScale.y || 1)}px`; document.body.append(line);
          }
          if (yActive) {
            const line = document.createElement('div'); line.className = 'editor-smart-guide horizontal'; line.style.cssText = `left:${bodyX(containerRect.left)}px;top:${bodyY(y.guide)}px;width:${containerRect.width / (bodyScale.x || 1)}px;height:${1 / (bodyScale.y || 1)}px`; document.body.append(line);
          }
          if (others.length >= 2 && xActive && yActive) {
            const feedback = document.createElement('div'); feedback.className = 'editor-smart-guide spacing'; feedback.textContent = '等距'; feedback.style.cssText = `left:${bodyX(right + 8)}px;top:${bodyY(top)}px;width:auto;height:auto;padding:2px 5px;color:#fff;font:11px system-ui;background:#f43f5e`; document.body.append(feedback);
          }
        }
        updateResizeHandle(document);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.querySelectorAll('.editor-smart-guide,.editor-position-badge').forEach((element) => element.remove());
        if (moved) commit(before);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    document.addEventListener('dblclick', (event) => {
      const rawTarget = event.target as HTMLElement;
      const fragment = rawTarget.closest<HTMLElement>('[data-editor-text-owner]');
      if (fragment) {
        editingBeforeRef.current = snapshot();
        fragment.dataset.editorRichText = 'true';
        fragment.contentEditable = 'true';
        fragment.focus();
        return;
      }
      const target = rawTarget.closest<HTMLElement>('[data-editor-id],[data-editor-new]');
      if (!target) return;
      const kind = target.dataset.editorKind ?? '';
      // A table is selected as one object, but editing happens per cell.
      if (kind === 'table') {
        const cell = rawTarget.closest<HTMLElement>('td,th');
        if (!cell || !target.contains(cell)) return;
        editingBeforeRef.current = snapshot();
        cell.contentEditable = 'true';
        cell.focus();
        return;
      }
      if (!isTextElement(target) && !SHAPE_KINDS_WITH_TEXT.includes(kind)) return;
      editingBeforeRef.current = snapshot();
      target.dataset.editorRichText = 'true';
      target.contentEditable = 'true';
      target.focus();
    });
    document.addEventListener('selectionchange', () => {
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && (range.commonAncestorContainer.parentElement?.closest('[contenteditable="true"]') || (range.commonAncestorContainer as HTMLElement).closest?.('[contenteditable="true"]'))) {
        richRangeRef.current = range.cloneRange();
      }
    });
    document.addEventListener('focusout', (event) => {
      const target = event.target as HTMLElement;
      if (!target.isContentEditable) return;
      target.contentEditable = 'false';
      if (editingBeforeRef.current !== null) commit(editingBeforeRef.current);
      editingBeforeRef.current = null;
    });
    document.addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement).isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        history(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        history('redo');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedRef.current.length) {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection(); else groupSelection();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current.length) {
        event.preventDefault();
        remove();
        return;
      }
      if (!selectedRef.current.length) return;
      const delta = event.shiftKey ? 10 : 1;
      const vectors: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
      if (!vectors[event.key]) return;
      if (selectedRef.current.some((element) => element.dataset.editorRestricted === 'true')) {
        setNotice({ type: 'error', text: '受限元素不可直接微調；請先使用「轉為自由定位」。' });
        return;
      }
      event.preventDefault();
      const before = snapshot();
      for (const element of selectedRef.current) {
        const container = selectedContainer(document, element);
        const moved = detachFlowElementForMove(document, element, container);
        const offsetParent = (moved.offsetParent as HTMLElement | null) ?? container;
        const scale = editorScale(offsetParent);
        element.style.left = `${Number.parseFloat(element.style.left) + vectors[event.key][0] / scale.x}px`;
        element.style.top = `${Number.parseFloat(element.style.top) + vectors[event.key][1] / scale.y}px`;
      }
      commit(before);
    });
    document.addEventListener('paste', (event) => {
      const image = [...event.clipboardData?.items ?? []].find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      void addImage(image);
    });
    document.addEventListener('contextmenu', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-id],[data-editor-new]');
      if (!target) return;
      event.preventDefault();
      if (!selectedRef.current.includes(target)) refreshSelection([target]);
      const frameRect = iframeRef.current?.getBoundingClientRect();
      setContextMenu({ x: (frameRect?.left ?? 0) + event.clientX, y: (frameRect?.top ?? 0) + event.clientY });
    });

    const message = editorDeck?.initiallyAllHidden
      ? `來源投影片由腳本啟用；編輯模式已暫時顯示第 1 張（共 ${editorDeck.slideCount} 張），可用上／下一頁切換且不會把暫時狀態寫回來源。`
      : workspace.compatibility.level === 'MIXED'
      ? `混合支援：${workspace.compatibility.reasons.join('；')}。其他元素與自由插入仍可使用。`
      : workspace.compatibility.reasons[0] ?? '已進入編輯模式。點選可移動，雙擊文字可編輯。';
    setNotice({ type: 'info', text: message });
    window.requestAnimationFrame(() => fitCanvas('width'));
  };

  const adoptWorkspace = (loaded: WorkspacePayload, message: string) => {
    setWorkspace(loaded);
    setMode('edit');
    undoRef.current = [];
    redoRef.current = [];
    baselineRef.current = new Map();
    editorDeckRef.current = null;
    setEditorDeckPosition(null);
    originalSpeakerNotesRef.current = loaded.speakerNotes ? [...loaded.speakerNotes] : null;
    updateSpeakerNotes(loaded.speakerNotes ? [...loaded.speakerNotes] : null);
    setNotesOpen(false);
    setPresenterIndex(0);
    setZoom(100);
    refreshSelection([]);
    setNotice({ type: 'info', text: message });
    void listSnapshots(loaded.id).then(setSnapshots).catch(() => setSnapshots([]));
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const loaded = await importFile(file);
      adoptWorkspace(loaded, `已匯入 ${file.name}`);
      refreshStorageDiagnostics();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '匯入失敗。' });
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const mutate = (action: (document: Document, container: HTMLElement) => HTMLElement | void, preserveSelection = false) => {
    const document = doc();
    if (!document) return;
    const before = snapshot();
    const container = selectedContainer(document, selectedRef.current[0] ?? null);
    const created = action(document, container);
    commit(before, preserveSelection);
    if (created) {
      refreshSelection([created]);
      updateResizeHandle(document);
    }
  };

  const insert = (kind: 'text' | 'rectangle' | 'rounded' | 'ellipse' | 'line' | 'arrow' | 'triangle') => mutate((document) => {
    const layer = freePositionLayer(document, selectedRef.current[0] ?? null);
    const element = document.createElement('div');
    element.dataset.editorNew = crypto.randomUUID();
    element.dataset.editorKind = kind;
    const objectIndex = layer.querySelectorAll(':scope > [data-editor-new]').length;
    const objectLeft = 100 + (objectIndex % 5) * 210;
    const objectTop = 80 + Math.floor(objectIndex / 5) * 145;
    const base = `position:absolute;left:${objectLeft}px;top:${objectTop}px;width:180px;height:100px;background:#5b7cfa;border:2px solid #3659d9;z-index:10;pointer-events:auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:8px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:20px;line-height:1.3;text-align:center;color:#ffffff;`;
    const shapeStyles: Record<string, string> = {
      rectangle: '', rounded: 'border-radius:24px;', ellipse: 'border-radius:999px;',
      line: 'height:4px;border:0;background:#3659d9;top:130px;',
      arrow: 'height:44px;border:0;clip-path:polygon(0 35%,72% 35%,72% 0,100% 50%,72% 100%,72% 65%,0 65%);',
      triangle: 'clip-path:polygon(50% 0,100% 100%,0 100%);border:0;',
    };
    element.style.cssText = kind === 'text'
      ? 'position:absolute;left:48px;top:48px;width:360px;min-height:48px;padding:8px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:28px;font-weight:400;line-height:1.2;text-align:left;color:#172033;background:transparent;z-index:10;pointer-events:auto;box-sizing:border-box;'
      : base + shapeStyles[kind];
    element.textContent = kind === 'text' ? '雙擊編輯文字' : '';
    layer.append(element);
    return element;
  });

  const insertTable = (rows = 3, columns = 3) => mutate((document) => {
    const layer = freePositionLayer(document, selectedRef.current[0] ?? null);
    const table = document.createElement('table');
    table.dataset.editorNew = crypto.randomUUID();
    table.dataset.editorKind = 'table';
    const index = layer.querySelectorAll(':scope > [data-editor-new]').length;
    table.style.cssText = `position:absolute;left:${120 + (index % 5) * 24}px;top:${120 + (index % 5) * 24}px;width:720px;border-collapse:collapse;table-layout:fixed;z-index:10;pointer-events:auto;box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:20px;line-height:1.4;color:#172033;background:#ffffff;`;
    const body = document.createElement('tbody');
    for (let row = 0; row < rows; row += 1) {
      const tr = document.createElement('tr');
      for (let column = 0; column < columns; column += 1) {
        const heading = row === 0;
        const cell = document.createElement(heading ? 'th' : 'td');
        cell.textContent = heading ? `標題 ${column + 1}` : '';
        cell.style.cssText = `border:1px solid #c9ced6;padding:10px 12px;text-align:left;vertical-align:middle;${heading ? 'background:#f1f3f5;font-weight:700;' : ''}`;
        tr.append(cell);
      }
      body.append(tr);
    }
    table.append(body);
    layer.append(table);
    return table;
  });

  const modifyTable = (action: 'add-row' | 'remove-row' | 'add-column' | 'remove-column') => {
    const table = selectedRef.current[0];
    if (!table || table.dataset.editorKind !== 'table') return;
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tr')];
    if (!rows.length) return;
    if (action === 'remove-row' && rows.length <= 1) {
      setNotice({ type: 'error', text: '表格至少需要保留一列。' });
      return;
    }
    if (action === 'remove-column' && rows[0].cells.length <= 1) {
      setNotice({ type: 'error', text: '表格至少需要保留一欄。' });
      return;
    }
    const before = snapshot();
    if (action === 'add-row') {
      const last = rows[rows.length - 1];
      const clone = last.cloneNode(true) as HTMLTableRowElement;
      [...clone.cells].forEach((cell) => { cell.textContent = ''; });
      last.after(clone);
    } else if (action === 'remove-row') {
      rows[rows.length - 1].remove();
    } else if (action === 'add-column') {
      for (const row of rows) {
        const last = row.cells[row.cells.length - 1];
        if (!last) continue;
        const clone = last.cloneNode(true) as HTMLTableCellElement;
        clone.textContent = last.tagName === 'TH' ? '標題' : '';
        last.after(clone);
      }
    } else {
      for (const row of rows) row.cells[row.cells.length - 1]?.remove();
    }
    commit(before, true);
    setNotice({ type: 'info', text: `表格已更新為 ${table.querySelectorAll('tr').length} 列 × ${(table.querySelector('tr')?.cells.length ?? 0)} 欄。` });
  };

  const applyObjectStyle = (styles: Record<string, string>) => {
    if (!selectedRef.current.length) return;
    const before = snapshot();
    selectedRef.current.forEach((target) => Object.entries(styles).forEach(([property, value]) => target.style.setProperty(property, value)));
    commit(before, true);
  };

  const restoreVersion = async (snapshotId?: string) => {
    if (!workspace) return;
    try {
      const loaded = await restoreWorkspace(workspace.id, snapshotId);
      adoptWorkspace(loaded, snapshotId ? '已還原所選快照。' : '已還原原始匯入版本；原檔沒有被覆寫。');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '無法還原版本。' });
    }
  };

  const setRotation = (value: number) => {
    if (!Number.isFinite(value)) return;
    const before = snapshot();
    selectedRef.current.forEach((target) => { target.dataset.editorRotation = String(value); applyElementTransform(target); });
    commit(before, true);
  };

  const setAnimation = (value: 'none' | 'fade' | 'rise') => {
    const document = doc();
    if (!document || !selectedRef.current.length) return;
    const before = snapshot();
    const slide = document.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (slide && !slide.querySelector('[data-editor-animation-styles]')) {
      const style = document.createElement('style');
      style.dataset.editorNew = crypto.randomUUID(); style.dataset.editorAnimationStyles = 'true';
      style.textContent = '@keyframes editorFade{from{opacity:0}to{opacity:1}}@keyframes editorRise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}';
      slide.append(style);
    }
    selectedRef.current.forEach((target) => {
      target.dataset.editorAnimation = value;
      target.style.animation = value === 'fade' ? 'editorFade .6s ease both' : value === 'rise' ? 'editorRise .6s ease both' : 'none';
    });
    commit(before, true);
  };

  const flipSelected = (axis: 'x' | 'y') => {
    const before = snapshot();
    selectedRef.current.forEach((target) => {
      const key = axis === 'x' ? 'editorFlipX' : 'editorFlipY';
      target.dataset[key] = String(target.dataset[key] !== 'true');
      applyElementTransform(target);
    });
    commit(before, true);
  };

  const setObjectPosition = (property: 'left' | 'top' | 'width' | 'height', value: number) => {
    const document = doc();
    if (!document || !Number.isFinite(value)) return;
    const before = snapshot();
    selectedRef.current.forEach((target) => {
      const container = selectedContainer(document, target);
      prepareAbsolute(target, (target.offsetParent as HTMLElement | null) ?? container);
      const nextValue = Math.max(property === 'width' || property === 'height' ? 1 : -10000, value);
      if ((property === 'width' || property === 'height') && target.dataset.editorLockAspect === 'true') {
        const ratio = (target.offsetWidth || 1) / (target.offsetHeight || 1);
        if (property === 'width') { target.style.width = `${nextValue}px`; target.style.height = `${Math.max(1, nextValue / ratio)}px`; }
        else { target.style.height = `${nextValue}px`; target.style.width = `${Math.max(1, nextValue * ratio)}px`; }
      } else {
        target.style[property] = `${nextValue}px`;
      }
    });
    commit(before, true);
  };
  const setLockAspect = (locked: boolean) => {
    const target = selectedRef.current[0];
    if (!target) return;
    const before = snapshot();
    target.dataset.editorLockAspect = String(locked);
    commit(before, true);
  };

  const addImage = async (file?: File) => {
    const document = doc();
    if (!document || !workspace || !file) return;
    try {
      const src = await uploadAsset(workspace.id, file);
      const selectedImage = selectedRef.current.length === 1 && selectedRef.current[0].tagName === 'IMG' ? selectedRef.current[0] as HTMLImageElement : null;
      mutate(() => {
        if (selectedImage) {
          selectedImage.src = src;
          selectedImage.alt = file.name;
          setNotice({ type: 'info', text: '已替換選取圖片。' });
          return selectedImage;
        }
        const layer = freePositionLayer(document, selectedRef.current[0] ?? null);
        const image = document.createElement('img');
        image.dataset.editorNew = crypto.randomUUID();
        image.dataset.editorKind = 'image';
        image.src = src;
        image.alt = file.name;
        image.style.cssText = 'position:absolute;left:760px;top:80px;width:180px;height:auto;z-index:10;pointer-events:auto;';
        layer.append(image);
        return image;
      }, Boolean(selectedImage));
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '加入圖片失敗。' });
    }
  };

  const captureSelectionItems = (document: Document, sources: HTMLElement[]): ClipboardItem[] => sources.map((source) => {
    const container = selectedContainer(document, source);
    const containerRect = container.getBoundingClientRect();
    const rect = source.getBoundingClientRect();
    const scale = editorScale(container);
    const clone = cloneEditorElementForReuse(source);
    const computed = getComputedStyle(source);
    for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'color']) {
      clone.style.setProperty(property, computed.getPropertyValue(property));
    }
    return {
      html: clone.outerHTML,
      left: (rect.left - containerRect.left) / scale.x,
      top: (rect.top - containerRect.top) / scale.y,
      width: rect.width / scale.x,
      height: rect.height / scale.y,
    };
  });

  const materializeItems = (document: Document, items: ClipboardItem[], offset: number): HTMLElement[] => {
    const layer = freePositionLayer(document, null);
    const created: HTMLElement[] = [];
    for (const item of items) {
      const template = document.createElement('template');
      template.innerHTML = item.html.trim();
      const clone = template.content.firstElementChild as HTMLElement | null;
      if (!clone) continue;
      clone.dataset.editorNew = crypto.randomUUID();
      clone.style.position = 'absolute';
      clone.style.left = `${Math.round(item.left + offset)}px`;
      clone.style.top = `${Math.round(item.top + offset)}px`;
      clone.style.width = `${Math.round(item.width)}px`;
      clone.style.height = `${Math.round(item.height)}px`;
      clone.style.margin = '0px';
      clone.style.pointerEvents = 'auto';
      layer.append(clone);
      created.push(clone);
    }
    return created;
  };

  const copySelection = () => {
    const document = doc();
    if (!document || !selectedRef.current.length) return;
    clipboardRef.current = captureSelectionItems(document, selectedRef.current);
    pasteOffsetRef.current = 0;
    setNotice({ type: 'info', text: `已複製 ${clipboardRef.current.length} 個元素；可按 Ctrl+V 或「貼上」。` });
  };

  const pasteSelection = () => {
    const document = doc();
    if (!document || !clipboardRef.current.length) return;
    const before = snapshot();
    pasteOffsetRef.current += 16;
    const created = materializeItems(document, clipboardRef.current, pasteOffsetRef.current);
    commit(before, false);
    refreshSelection(created);
    updateResizeHandle(document);
    setNotice({ type: 'info', text: `已貼上 ${created.length} 個元素。` });
  };

  // Duplicate deliberately snapshots the selection directly instead of routing
  // through copy+paste, so Ctrl+D never overwrites what the user has on the
  // clipboard.
  const duplicateSelection = () => {
    const document = doc();
    if (!document || !selectedRef.current.length) return;
    const before = snapshot();
    const created = materializeItems(document, captureSelectionItems(document, selectedRef.current), 16);
    if (!created.length) return;
    commit(before, false);
    refreshSelection(created);
    updateResizeHandle(document);
    setNotice({ type: 'info', text: `已建立 ${created.length} 個副本。` });
  };

  // Appearance only — position and size are deliberately excluded so applying a
  // format never moves or resizes the target.
  const FORMAT_PROPERTIES = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'color',
    'line-height', 'letter-spacing', 'text-align', 'text-decoration-line',
    'background-color', 'border-width', 'border-style', 'border-color',
    'border-radius', 'box-shadow', 'opacity', 'padding',
  ];

  const copyFormat = () => {
    const source = selectedRef.current[0];
    if (!source) return;
    const computed = getComputedStyle(source);
    const captured: Record<string, string> = {};
    for (const property of FORMAT_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) captured[property] = value;
    }
    formatClipboardRef.current = captured;
    setHasCopiedFormat(true);
    setNotice({ type: 'info', text: '已複製格式；選取其他元素後按「套用格式」即可套用。' });
  };

  const applyFormat = () => {
    const captured = formatClipboardRef.current;
    if (!captured || !selectedRef.current.length) return;
    const before = snapshot();
    for (const target of selectedRef.current) {
      for (const [property, value] of Object.entries(captured)) target.style.setProperty(property, value);
    }
    commit(before, true);
    setNotice({ type: 'info', text: `已將格式套用到 ${selectedRef.current.length} 個元素。` });
  };

  const remove = () => mutate(() => { selectedRef.current.forEach((item) => item.remove()); });
  const layerContainer = (document: Document, element: HTMLElement) => element.parentElement ?? selectedContainer(document, element);
  const layerOrder = (document: Document, element: HTMLElement) => {
    const container = layerContainer(document, element);
    const peers = [...container.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
      .filter((item) => item.parentElement === container && !item.matches('[data-editor-flow-placeholder="true"]'));
    return peers.sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
  };
  const computeLayerItems = (document: Document, selected: HTMLElement[]): LayerItem[] => {
    const currentSlide = document.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    const anchor = selected[0] ?? currentSlide?.querySelector<HTMLElement>(':scope > [data-editor-id],[data-editor-new]') ?? null;
    return anchor ? layerOrder(document, anchor).slice().reverse().map((element) => ({ key: layerKey(element), label: layerLabel(element) })) : [];
  };
  const zOrder = (delta: number) => {
    mutate(() => {
    const document = doc();
    if (!document) return;
    const byContainer = new Map<HTMLElement, HTMLElement[]>();
    for (const item of selectedRef.current) {
      const container = layerContainer(document, item);
      byContainer.set(container, [...(byContainer.get(container) ?? []), item]);
    }
    for (const [container, selected] of byContainer) {
      const order = layerOrder(document, selected[0]);
      const selectedSet = new Set(selected);
      if (delta > 0) {
        for (let index = order.length - 2; index >= 0; index -= 1) {
          if (selectedSet.has(order[index]) && !selectedSet.has(order[index + 1])) [order[index], order[index + 1]] = [order[index + 1], order[index]];
        }
      } else {
        for (let index = 1; index < order.length; index += 1) {
          if (selectedSet.has(order[index]) && !selectedSet.has(order[index - 1])) [order[index], order[index - 1]] = [order[index - 1], order[index]];
        }
      }
      order.forEach((item, index) => { item.style.zIndex = String(index + 1); });
      void container;
    }
    }, true);
    setSelectionEpoch((value) => value + 1);
  };

  const selectLayer = (key: string) => {
    const document = doc();
    const element = document?.querySelector<HTMLElement>(`[data-editor-id="${key}"],[data-editor-new="${key}"]`);
    if (!document || !element) return;
    refreshSelection([element]);
    updateResizeHandle(document);
  };
  const moveLayer = (key: string, delta: number) => { selectLayer(key); zOrder(delta); };

  const moveElementByViewportDelta = (element: HTMLElement, deltaX: number, deltaY: number, fallback: HTMLElement) => {
    const offsetParent = (element.offsetParent as HTMLElement | null) ?? fallback;
    const scale = editorScale(offsetParent);
    element.style.left = `${Math.round((Number.parseFloat(element.style.left) || 0) + deltaX / scale.x)}px`;
    element.style.top = `${Math.round((Number.parseFloat(element.style.top) || 0) + deltaY / scale.y)}px`;
  };

  const arrangeableSelection = (document: Document) => {
    const elements = selectedRef.current;
    if (elements.length < 2) return null;
    if (elements.some((element) => element.dataset.editorRestricted === 'true')) {
      setNotice({ type: 'error', text: '選取項目包含不可直接定位的高風險元素。' });
      return null;
    }
    const container = selectedContainer(document, elements[0]);
    if (elements.some((element) => selectedContainer(document, element) !== container)) {
      setNotice({ type: 'error', text: '跨頁元素不能一起排列。' });
      return null;
    }
    const moved = elements.map((element) => detachFlowElementForMove(document, element, container));
    refreshSelection(moved);
    return { elements: moved, container };
  };

  const alignSelection = (edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const document = doc();
    if (!document) return;
    const before = snapshot();
    const arranged = arrangeableSelection(document);
    if (!arranged) return;
    const { elements, container } = arranged;
    const rects = elements.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const left = Math.min(...rects.map(({ rect }) => rect.left));
    const right = Math.max(...rects.map(({ rect }) => rect.right));
    const top = Math.min(...rects.map(({ rect }) => rect.top));
    const bottom = Math.max(...rects.map(({ rect }) => rect.bottom));
    for (const { element, rect } of rects) {
      const deltaX = edge === 'left' ? left - rect.left : edge === 'center' ? (left + right - rect.left - rect.right) / 2 : edge === 'right' ? right - rect.right : 0;
      const deltaY = edge === 'top' ? top - rect.top : edge === 'middle' ? (top + bottom - rect.top - rect.bottom) / 2 : edge === 'bottom' ? bottom - rect.bottom : 0;
      moveElementByViewportDelta(element, deltaX, deltaY, container);
    }
    commit(before, true);
    setNotice({ type: 'info', text: `已將 ${elements.length} 個元素完成對齊。` });
  };

  // Unlike alignSelection this works on a single element, because centring one
  // object on the page is the common case it exists for.
  const alignToSlide = (edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const document = doc();
    const selected = selectedRef.current;
    if (!document || !selected.length) return;
    if (selected.some((element) => element.dataset.editorRestricted === 'true')) {
      setNotice({ type: 'error', text: '選取項目包含不可直接定位的高風險元素。' });
      return;
    }
    const before = snapshot();
    const container = selectedContainer(document, selected[0]);
    const slide = document.querySelector<HTMLElement>('[data-editor-current-slide="true"]') ?? container;
    const slideRect = slide.getBoundingClientRect();
    const moved = selected.map((element) => detachFlowElementForMove(document, element, container));
    refreshSelection(moved);
    for (const element of moved) {
      const rect = element.getBoundingClientRect();
      const deltaX = edge === 'left' ? slideRect.left - rect.left
        : edge === 'center' ? (slideRect.left + slideRect.right - rect.left - rect.right) / 2
        : edge === 'right' ? slideRect.right - rect.right : 0;
      const deltaY = edge === 'top' ? slideRect.top - rect.top
        : edge === 'middle' ? (slideRect.top + slideRect.bottom - rect.top - rect.bottom) / 2
        : edge === 'bottom' ? slideRect.bottom - rect.bottom : 0;
      moveElementByViewportDelta(element, deltaX, deltaY, container);
    }
    commit(before, true);
    setNotice({ type: 'info', text: `已將 ${moved.length} 個元素對齊投影片。` });
  };

  const distributeSelection = (axis: 'horizontal' | 'vertical') => {
    const document = doc();
    if (!document || selectedRef.current.length < 3) return;
    const before = snapshot();
    const arranged = arrangeableSelection(document);
    if (!arranged) return;
    const { elements, container } = arranged;
    const items = elements.map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((a, b) => axis === 'horizontal' ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
    const start = axis === 'horizontal' ? items[0].rect.left : items[0].rect.top;
    const end = axis === 'horizontal' ? items.at(-1)!.rect.right : items.at(-1)!.rect.bottom;
    const occupied = items.reduce((sum, item) => sum + (axis === 'horizontal' ? item.rect.width : item.rect.height), 0);
    const gap = (end - start - occupied) / (items.length - 1);
    let cursor = start;
    items.forEach(({ element, rect }, index) => {
      if (index > 0 && index < items.length - 1) {
        const current = axis === 'horizontal' ? rect.left : rect.top;
        moveElementByViewportDelta(element, axis === 'horizontal' ? cursor - current : 0, axis === 'vertical' ? cursor - current : 0, container);
      }
      cursor += (axis === 'horizontal' ? rect.width : rect.height) + gap;
    });
    commit(before, true);
    setNotice({ type: 'info', text: `已${axis === 'horizontal' ? '水平' : '垂直'}均分 ${elements.length} 個元素。` });
  };

  const groupSelection = () => {
    const document = doc();
    if (!document || selectedRef.current.length < 2) return;
    const before = snapshot();
    const arranged = arrangeableSelection(document);
    if (!arranged) return;
    const { elements } = arranged;
    const layer = freePositionLayer(document, elements[0]);
    const layerRect = layer.getBoundingClientRect();
    const scale = editorScale(layer);
    const rects = elements.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const left = Math.min(...rects.map(({ rect }) => rect.left));
    const top = Math.min(...rects.map(({ rect }) => rect.top));
    const right = Math.max(...rects.map(({ rect }) => rect.right));
    const bottom = Math.max(...rects.map(({ rect }) => rect.bottom));
    const group = document.createElement('div');
    group.dataset.editorNew = crypto.randomUUID();
    group.dataset.editorKind = 'group';
    group.style.cssText = `position:absolute;left:${Math.round((left - layerRect.left) / scale.x)}px;top:${Math.round((top - layerRect.top) / scale.y)}px;width:${Math.round((right - left) / scale.x)}px;height:${Math.round((bottom - top) / scale.y)}px;z-index:10;pointer-events:auto;`;
    for (const { element, rect } of rects) {
      if (element.dataset.editorId) element.dataset.editorSourceConsumed = 'true';
      element.style.position = 'absolute';
      element.style.left = `${Math.round((rect.left - left) / scale.x)}px`;
      element.style.top = `${Math.round((rect.top - top) / scale.y)}px`;
      element.style.margin = '0px';
      group.append(element);
    }
    layer.append(group);
    commit(before, false);
    refreshSelection([group]);
    updateResizeHandle(document);
    setNotice({ type: 'info', text: `已群組 ${elements.length} 個元素；移動群組時會一起移動。` });
  };

  const ungroupSelection = () => {
    const document = doc();
    const group = selectedRef.current.length === 1 ? selectedRef.current[0] : null;
    if (!document || !group || group.dataset.editorKind !== 'group' || !group.parentElement) return;
    const before = snapshot();
    const parent = group.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const scale = editorScale(parent);
    const children = Array.from(group.children) as HTMLElement[];
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      child.style.position = 'absolute';
      child.style.left = `${Math.round((rect.left - parentRect.left) / scale.x)}px`;
      child.style.top = `${Math.round((rect.top - parentRect.top) / scale.y)}px`;
      child.style.width = `${Math.round(rect.width / scale.x)}px`;
      child.style.height = `${Math.round(rect.height / scale.y)}px`;
      parent.insertBefore(child, group);
    }
    group.remove();
    commit(before, false);
    refreshSelection(children);
    setNotice({ type: 'info', text: `已取消群組，保留 ${children.length} 個元素的位置。` });
  };

  const convertToFreePosition = () => mutate((document) => {
    const target = selectedRef.current[0];
    if (!target || target.dataset.editorRestricted !== 'true') return;
    if (target.children.length > 0) {
      setNotice({ type: 'error', text: '此受限容器含有子元素，Stage 0 不會直接搬移整個子樹；請選取其中的文字或圖片元素。' });
      return;
    }
    const rect = target.getBoundingClientRect();
    const layer = freePositionLayer(document, target);
    const layerRect = layer.getBoundingClientRect();
    const converted = target.cloneNode(true) as HTMLElement;
    converted.removeAttribute('data-editor-id');
    converted.dataset.editorNew = crypto.randomUUID();
    converted.dataset.editorFreePosition = 'true';
    converted.removeAttribute('data-editor-restricted');
    converted.removeAttribute('data-editor-restricted-reason');
    converted.style.position = 'absolute';
    converted.style.left = `${Math.round(rect.left - layerRect.left)}px`;
    converted.style.top = `${Math.round(rect.top - layerRect.top)}px`;
    converted.style.width = `${Math.round(rect.width)}px`;
    converted.style.height = `${Math.round(rect.height)}px`;
    converted.style.margin = '0px';
    converted.style.transform = 'none';
    converted.style.pointerEvents = 'auto';
    layer.append(converted);
    target.remove();
    setNotice({ type: 'info', text: '已轉為自由定位；可使用復原回到轉換前狀態。' });
    return converted;
  }, true);

  const unlockCurrentSlide = () => {
    const document = doc();
    const slide = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]') ?? (document ? selectedContainer(document, selectedRef.current[0] ?? null) : null);
    if (!document || !slide) return;
    const before = snapshot();
    const candidates = [...slide.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
      .filter((element) => element.dataset.editorKind !== 'free-layer' && !element.parentElement?.closest('[data-editor-id],[data-editor-new]'));
    for (const element of candidates) {
      element.removeAttribute('data-editor-restricted');
      element.removeAttribute('data-editor-restricted-reason');
      element.dataset.editorFreePosition = 'true';
      detachFlowElementForMove(document, element, slide);
    }
    commit(before, false);
    setNotice({ type: 'info', text: `已解鎖本頁 ${candidates.length} 個頂層物件；範圍僅限目前投影片，可用復原還原。` });
  };

  const setSlideBackground = (color: string) => {
    const document = doc(); const slide = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!slide) return;
    const before = snapshot(); slide.style.backgroundColor = color; commit(before, false);
  };

  const setSlideBackgroundImage = async (file?: File) => {
    const document = doc(); const slide = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!workspace || !slide || !file) return;
    try {
      const src = await uploadAsset(workspace.id, file); const before = snapshot();
      slide.style.backgroundImage = `url("${src}")`; slide.style.backgroundSize = 'cover'; slide.style.backgroundPosition = 'center';
      commit(before, false);
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '背景圖片載入失敗。' }); }
  };

  const setSlideRatio = (ratio: '16:9' | '4:3') => {
    const document = doc(); const slide = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!slide) return;
    const before = snapshot();
    slide.style.width = '1600px'; slide.style.height = ratio === '16:9' ? '900px' : '1200px'; slide.dataset.editorSlideRatio = ratio;
    commit(before, false); fitCanvas('slide');
    setNotice({ type: 'info', text: `投影片尺寸已設為 ${ratio}；物件座標維持不變。` });
  };

  const history = (direction: 'undo' | 'redo') => {
    const document = doc();
    if (!document) return;
    const from = direction === 'undo' ? undoRef.current : redoRef.current;
    const to = direction === 'undo' ? redoRef.current : undoRef.current;
    const state = from.pop();
    if (state === undefined) return;
    const selected = selectedRef.current[0];
    const id = selected?.dataset.editorId;
    const created = selected?.dataset.editorNew;
    to.push(historySnapshot());
    document.body.innerHTML = state.body;
    updateSpeakerNotes(state.notes);
    document.querySelectorAll('.editor-resize-handle').forEach((element) => element.remove());
    hideAlignmentGrid(document);
    initializeEditorDeck(document, state.slideIndex);
    installEditableDecorations(document);
    const restored = id
      ? document.querySelector<HTMLElement>(`[data-editor-id="${id}"]`)
      : created ? document.querySelector<HTMLElement>(`[data-editor-new="${created}"]`) : null;
    refreshSelection(restored ? [restored] : []);
    updateResizeHandle(document);
  };

  const applyTextStyle = (property: string, value: string) => {
    const targets = selectedRef.current.filter((element) => isTextElement(element));
    if (!targets.length) return;
    const before = snapshot();
    targets.forEach((target) => target.style.setProperty(property, value));
    commit(before, true);
  };
  const applyFontSize = (value: number) => {
    if (!Number.isFinite(value) || value < 8 || value > 240) return;
    applyTextStyle('font-size', `${value}px`);
  };
  const applyLineHeight = (value: number, commitChange = true) => {
    const targets = selectedRef.current.filter((element) => isTextElement(element));
    if (!targets.length || !Number.isFinite(value) || value < 0.8 || value > 3) return;
    const before = snapshot();
    targets.forEach((target) => { target.style.lineHeight = String(Math.round(value * 100) / 100); });
    setTextStyle(readTextStyle(targets[0]));
    if (commitChange) commit(before, true);
  };
  const beginLineChange = () => { if (lineBeforeRef.current === null) lineBeforeRef.current = snapshot(); };
  const finishLineChange = () => {
    if (lineBeforeRef.current === null) return;
    const before = lineBeforeRef.current;
    lineBeforeRef.current = null;
    commit(before, true);
  };
  const applyColor = (value: string) => {
    if (!/^#[\da-f]{6}$/i.test(value)) {
      setNotice({ type: 'error', text: '色彩必須是六位 HEX，例如 #3366FF。前一合法值未被修改。' });
      return;
    }
    const normalized = value.toUpperCase();
    setRecentColors((current) => [normalized, ...current.filter((color) => color !== normalized)].slice(0, 8));
    setColorDraft(normalized);
    applyTextStyle('color', normalized);
  };

  const operations = () => {
    const document = doc();
    const result: PatchOperation[] = document ? buildOperations(document, baselineRef.current) : [];
    if (speakerNotesRef.current && JSON.stringify(speakerNotesRef.current) !== JSON.stringify(originalSpeakerNotesRef.current)) {
      result.push({ type: 'replaceSpeakerNotes', notes: speakerNotesRef.current });
    }
    return result;
  };
  saveCurrentDraftRef.current = async () => {
    if (!workspace) return;
    try {
      await saveDraft(workspace.id, operations());
      setAutosaveState('saved');
      setSnapshots(await listSnapshots(workspace.id));
    } catch {
      setAutosaveState('error');
    }
  };

  const applyRichCommand = (command: string, value?: string) => {
    const document = doc();
    if (!document) return;
    const range = richRangeRef.current;
    const target = selectedRef.current.find((element) => isTextElement(element));
    if (!target) return;
    const before = snapshot();
    target.dataset.editorRichText = 'true';
    target.contentEditable = 'true';
    target.focus({ preventScroll: true });
    const selection = document.getSelection();
    if (range) { selection?.removeAllRanges(); selection?.addRange(range); }
    const toggleTags: Record<string, { tag: string; selector: string }> = {
      bold: { tag: 'strong', selector: 'b,strong' },
      italic: { tag: 'em', selector: 'i,em' },
      underline: { tag: 'u', selector: 'u' },
      strikeThrough: { tag: 's', selector: 's,strike' },
    };
    const toggle = toggleTags[command];
    if (toggle && range && !range.collapsed) {
      const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;
      const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer as Element
        : range.endContainer.parentElement;
      const activeWrapper = startElement?.closest<HTMLElement>(toggle.selector) ?? null;
      if (activeWrapper && activeWrapper === endElement?.closest(toggle.selector) && target.contains(activeWrapper)) {
        const unwrapped = [...activeWrapper.childNodes];
        activeWrapper.replaceWith(...unwrapped);
        if (unwrapped.length) {
          range.setStartBefore(unwrapped[0]);
          range.setEndAfter(unwrapped[unwrapped.length - 1]);
        }
      } else {
        const wrapper = document.createElement(toggle.tag);
        wrapper.append(range.extractContents());
        range.insertNode(wrapper);
        range.selectNodeContents(wrapper);
      }
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else if (toggle) {
      document.execCommand(command, false, value);
    } else if (range && !range.collapsed && ['foreColor', 'hiliteColor', 'fontName', 'fontSize'].includes(command)) {
      const wrapper = document.createElement('span');
      if (command === 'foreColor') wrapper.style.color = value ?? '';
      if (command === 'hiliteColor') wrapper.style.backgroundColor = value ?? '';
      if (command === 'fontName') wrapper.style.fontFamily = value ?? '';
      if (command === 'fontSize') wrapper.style.fontSize = value ?? '';
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      selection?.removeAllRanges(); selection?.addRange(range);
    } else document.execCommand(command, false, value);
    if (selection?.rangeCount) richRangeRef.current = selection.getRangeAt(0).cloneRange();
    selection?.removeAllRanges();
    target.contentEditable = 'false';
    commit(before, true);
  };

  const setZoomLevel = (value: number) => {
    const next = Math.max(25, Math.min(200, Math.round(value)));
    setZoom(next);
    const frame = iframeRef.current;
    if (frame) {
      const scale = next / 100;
      frame.style.removeProperty('transform-origin');
      frame.style.removeProperty('transform');
      frame.style.removeProperty('width');
      frame.style.removeProperty('height');
      frame.contentDocument?.documentElement.style.setProperty('zoom', String(scale));
    }
    requestAnimationFrame(() => interactionRef.current?.render());
  };

  const fitCanvas = (kind: 'slide' | 'width') => {
    const surface = workspaceRef.current;
    const frame = iframeRef.current;
    const document = doc();
    const slide = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!surface || !frame || !slide) return;
    const availableWidth = Math.max(1, frame.clientWidth - 2);
    const availableHeight = Math.max(1, frame.clientHeight - 2);
    const horizontal = Math.max(25, Math.min(200, availableWidth / Math.max(1, slide.offsetWidth) * 100));
    const vertical = Math.max(25, Math.min(200, availableHeight / Math.max(1, slide.offsetHeight) * 100));
    setZoomLevel(kind === 'slide' ? Math.min(horizontal, vertical) : horizontal);
  };
  fitCanvasRef.current = fitCanvas;
  const preview = async () => {
    if (!workspace) return;
    try {
      const updated = await saveDraft(workspace.id, operations());
      if (updated) setWorkspace(updated);
      setMode('preview');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '無法建立預覽。' });
    }
  };
  const doExport = async () => {
    if (!workspace) return;
    try {
      await exportProject(workspace.id, operations());
      const now = new Date().toISOString();
      localStorage.setItem(LAST_EXPORT_STORAGE_KEY, now);
      setLastExportedAt(now);
      setNotice({ type: 'info', text: '匯出完成。原始匯入檔案未被覆寫。' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '匯出失敗。' });
    }
  };

  const doPrint = async () => {
    if (!workspace) return;
    try { await printProject(workspace.id, operations()); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '無法建立列印版本。' }); }
  };

  const persistBrowserStorage = async () => {
    const granted = await requestPersistentStorage();
    setNotice({ type: granted ? 'info' : 'error', text: granted ? '瀏覽器已允許持久儲存。仍請定期匯出 HTML／ZIP 備份。' : '瀏覽器未授予持久儲存；工作區仍可使用，但可能在空間不足時被清除。' });
    refreshStorageDiagnostics();
  };

  const removeBrowserWorkspace = async () => {
    if (!workspace || !window.confirm('確定刪除此瀏覽器工作區與版本紀錄？請先匯出 HTML／ZIP 備份。')) return;
    await deleteWorkspace(workspace.id);
    setWorkspace(null);
    setStoragePanelOpen(false);
    setNotice({ type: 'info', text: '瀏覽器工作區已刪除；下載過的備份檔不受影響。' });
    refreshStorageDiagnostics();
  };

  const showEditorSlide = (index: number) => {
    const controller = editorDeckRef.current;
    const document = doc();
    if (!controller || !document) return;
    const current = controller.show(index);
    clearSelection();
    setEditorDeckPosition({ current, total: controller.slideCount });
    setNotice({ type: 'info', text: `編輯第 ${current + 1}／${controller.slideCount} 張；切頁狀態只存在編輯模式。` });
  };
  const openPresenterView = () => {
    setPresenterIndex(editorDeckPosition?.current ?? 0);
    presenterStartRef.current = Date.now();
    setPresenterElapsedMs(0);
    setMode('presenter');
    requestAnimationFrame(() => workspaceRef.current?.scrollTo({ top: 0, left: 0 }));
  };
  const changeEditorSlide = (delta: number) => showEditorSlide((editorDeckRef.current?.currentIndex ?? 0) + delta);

  const addSlide = () => {
    const document = doc();
    const controller = editorDeckRef.current;
    const current = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!document || !controller || !current?.parentElement) return;
    const before = snapshot();
    const notesBefore = speakerNotesRef.current ? [...speakerNotesRef.current] : null;
    const slide = current.cloneNode(false) as HTMLElement;
    slide.removeAttribute('id');
    slide.removeAttribute('data-editor-id');
    slide.removeAttribute('data-editor-deck-slide');
    slide.removeAttribute('data-editor-current-slide');
    slide.classList.remove('active', 'visible', 'editor-selected');
    slide.dataset.editorNew = crypto.randomUUID();
    slide.dataset.title = `新增頁面 ${controller.slideCount + 1}`;
    slide.setAttribute('aria-label', `第 ${controller.slideCount + 1} 頁`);
    for (const property of ['display', 'visibility', 'opacity', 'pointer-events', 'z-index', 'transform']) slide.style.removeProperty(property);
    const title = document.createElement('div');
    title.dataset.editorNew = crypto.randomUUID();
    title.dataset.editorKind = 'text';
    title.textContent = '新增頁面';
    title.style.cssText = 'position:absolute;left:80px;top:80px;width:520px;min-height:64px;padding:8px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:36px;font-weight:700;line-height:1.2;color:#172033;background:transparent;z-index:10;pointer-events:auto;';
    slide.append(title);
    current.parentElement.append(slide);
    if (speakerNotesRef.current) updateSpeakerNotes([...speakerNotesRef.current, '']);
    commit(before, false, notesBefore);
    initializeEditorDeck(document, controller.slideCount);
    refreshSelection([title]);
    updateResizeHandle(document);
    setNotice({ type: 'info', text: `已新增第 ${controller.slideCount + 1} 張；可使用復原取消。` });
  };

  const duplicateSlide = () => {
    const document = doc();
    const controller = editorDeckRef.current;
    const current = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!document || !controller || !current?.parentElement) return;
    const before = snapshot();
    const notesBefore = speakerNotesRef.current ? [...speakerNotesRef.current] : null;
    const copy = cloneEditorElementForReuse(current);
    cleanRuntimeDecorations(copy);
    copy.dataset.title = `${current.dataset.title || `第 ${controller.currentIndex + 1} 頁`}（副本）`;
    copy.setAttribute('aria-label', `第 ${controller.currentIndex + 2} 頁`);
    current.after(copy);
    if (speakerNotesRef.current) {
      const notes = [...speakerNotesRef.current];
      notes.splice(controller.currentIndex + 1, 0, notes[controller.currentIndex] ?? '');
      updateSpeakerNotes(notes);
    }
    commit(before, false, notesBefore);
    initializeEditorDeck(document, controller.currentIndex + 1);
    setNotice({ type: 'info', text: `已複製第 ${controller.currentIndex + 1} 張及其講者備註。` });
  };

  const reorderSlide = (delta: -1 | 1) => {
    const document = doc();
    const controller = editorDeckRef.current;
    const current = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!document || !controller || !current?.parentElement) return;
    const targetIndex = controller.currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= controller.slideCount) return;
    const slides = [...current.parentElement.querySelectorAll<HTMLElement>(':scope > .slide,:scope > [data-slide]')];
    const target = slides[targetIndex];
    if (!target) return;
    const before = snapshot();
    const notesBefore = speakerNotesRef.current ? [...speakerNotesRef.current] : null;
    if (delta < 0) current.parentElement.insertBefore(current, target);
    else current.parentElement.insertBefore(target, current);
    if (speakerNotesRef.current) {
      const notes = [...speakerNotesRef.current];
      const [moved] = notes.splice(controller.currentIndex, 1);
      notes.splice(targetIndex, 0, moved ?? '');
      updateSpeakerNotes(notes);
    }
    commit(before, false, notesBefore);
    initializeEditorDeck(document, targetIndex);
    setNotice({ type: 'info', text: `已將頁面移到第 ${targetIndex + 1} 張。` });
  };

  const deleteSlide = () => {
    const document = doc();
    const controller = editorDeckRef.current;
    const current = document?.querySelector<HTMLElement>('[data-editor-current-slide="true"]');
    if (!document || !controller || !current) return;
    if (controller.slideCount <= 1) {
      setNotice({ type: 'error', text: '簡報至少需要保留一張頁面。' });
      return;
    }
    const before = snapshot();
    const notesBefore = speakerNotesRef.current ? [...speakerNotesRef.current] : null;
    const deletedIndex = controller.currentIndex;
    current.remove();
    if (speakerNotesRef.current) updateSpeakerNotes(speakerNotesRef.current.filter((_note, index) => index !== deletedIndex));
    commit(before, false, notesBefore);
    initializeEditorDeck(document, Math.min(deletedIndex, controller.slideCount - 2));
    setNotice({ type: 'info', text: `已移除第 ${deletedIndex + 1} 張；可使用復原取回。` });
  };

  const runCommand = (id: CommandId) => {
    const actions: Record<CommandId, () => void> = {
      copy: copySelection, paste: pasteSelection, duplicate: duplicateSelection, delete: remove,
      'bring-forward': () => zOrder(1), 'send-backward': () => zOrder(-1),
      undo: () => history('undo'), redo: () => history('redo'), group: groupSelection, ungroup: ungroupSelection,
    };
    actions[id]();
  };

  const readOnly = workspace?.compatibility.documentReadOnly ?? false;
  const commonDisabled = !workspace || mode !== 'edit' || readOnly;
  useEffect(() => {
    const editorDocument = iframeRef.current?.contentDocument ?? null;
    if (!editorDocument) return;
    const canZOrder = (delta: number) => {
      if (!selectedRef.current.length) return false;
      return selectedRef.current.some((item) => {
        const container = layerContainer(editorDocument, item);
        const order = [...container.querySelectorAll<HTMLElement>('[data-editor-id],[data-editor-new]')]
          .filter((peer) => peer.parentElement === container && !peer.matches('[data-editor-flow-placeholder="true"]'))
          .sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
        const index = order.indexOf(item);
        return delta > 0 ? index < order.length - 1 : index > 0;
      });
    };
    const labels = [
      { text: '\u4e0a\u79fb\u4e00\u5c64', delta: 1 },
      { text: '\u4e0b\u79fb\u4e00\u5c64', delta: -1 },
    ];
    for (const button of window.document.querySelectorAll<HTMLButtonElement>('button')) {
      const layerControl = labels.find(({ text }) => button.textContent?.trim() === text);
      if (layerControl) button.disabled = commonDisabled || !canZOrder(layerControl.delta);
    }
  }, [commonDisabled, ribbonTab, selectionEpoch]);
  const selectedTarget = selectedRef.current[0] ?? null;
  const selectedIsImage = selectedTarget?.tagName === 'IMG';
  const selectedIsShape = Boolean(selectedTarget && ['rectangle', 'rounded', 'ellipse', 'line', 'arrow', 'triangle', 'decoration'].includes(selectedTarget.dataset.editorKind ?? ''));
  const selectedIsTable = selectedTarget?.dataset.editorKind === 'table';
  const selectedHoldsText = Boolean(selectedTarget && SHAPE_KINDS_WITH_TEXT.includes(selectedTarget.dataset.editorKind ?? ''));
  const isCompatibilityMode = Boolean(workspace && (workspace.compatibility.level === 'MIXED' || (!editorDeckPosition && workspace.compatibility.reasons.some((reason) => reason.includes('flow／flex／grid／responsive')))));
  const compatibilityLabel = !workspace ? '' : workspace.compatibility.level === 'READ_ONLY' ? '不安全／唯讀' : isCompatibilityMode ? '相容模式' : '完整編輯';
  const commandContext: CommandContext = selectedCount > 1
    ? 'multi'
    : selectedTarget?.dataset.editorKind === 'group'
      ? 'group'
      : textStyle
        ? 'text'
        : selectedTarget
          ? 'object'
          : 'slide';
  const commandContextLabel = {
    slide: '投影片',
    text: '文字編輯',
    object: selectedIsImage ? '圖片' : selectedIsShape ? '形狀' : '物件',
    multi: `${selectedCount} 個物件`,
    group: '群組',
  }[commandContext];
  const closeSiblingMenus = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    event.currentTarget.parentElement?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((item) => {
      if (item !== event.currentTarget) item.removeAttribute('open');
    });
  };
  const alignmentMenu = <details className="command-menu alignment-menu" onToggle={closeSiblingMenus}>
    <summary><IconAlign />對齊</summary>
    <div className="command-menu-panel alignment-panel">
      <strong>對齊選取的物件</strong>
      <div className="command-grid three">
        <button disabled={selectedCount < 2} onClick={() => alignSelection('left')}>靠左對齊</button>
        <button disabled={selectedCount < 2} onClick={() => alignSelection('center')}>水平置中</button>
        <button disabled={selectedCount < 2} onClick={() => alignSelection('right')}>靠右對齊</button>
        <button disabled={selectedCount < 2} onClick={() => alignSelection('top')}>靠上對齊</button>
        <button disabled={selectedCount < 2} onClick={() => alignSelection('middle')}>垂直置中</button>
        <button disabled={selectedCount < 2} onClick={() => alignSelection('bottom')}>靠下對齊</button>
      </div>
      <strong>平均分布</strong>
      <div className="command-grid two">
        <button disabled={selectedCount < 3} onClick={() => distributeSelection('horizontal')}>水平均分</button>
        <button disabled={selectedCount < 3} onClick={() => distributeSelection('vertical')}>垂直均分</button>
      </div>
      <strong>對齊到投影片</strong>
      <div className="command-grid three">
        <button aria-label="靠投影片左側對齊" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('left')}>靠左</button>
        <button aria-label="在投影片水平置中" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('center')}>水平置中</button>
        <button aria-label="靠投影片右側對齊" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('right')}>靠右</button>
        <button aria-label="靠投影片上緣對齊" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('top')}>靠上</button>
        <button aria-label="在投影片垂直置中" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('middle')}>垂直置中</button>
        <button aria-label="靠投影片下緣對齊" disabled={commonDisabled || selectedCount < 1} onClick={() => alignToSlide('bottom')}>靠下</button>
      </div>
      <p className="menu-hint">對齊需要 2 個物件；平均分布需要 3 個；對齊投影片 1 個即可。</p>
    </div>
  </details>;
  const groupMenu = <details className="command-menu group-menu" onToggle={closeSiblingMenus}>
    <summary><IconGroup />群組</summary>
    <div className="command-menu-panel group-panel">
      <button disabled={selectedCount < 2} onClick={groupSelection}><IconGroup />組成群組</button>
      <button disabled={selectedCount !== 1 || selectedTarget?.dataset.editorKind !== 'group'} onClick={ungroupSelection}><IconUnlock />取消群組</button>
    </div>
  </details>;
  const shapeMenu = <details className="command-menu shape-menu" onToggle={closeSiblingMenus}>
    <summary><IconRectangle />圖案</summary>
    <div className="command-menu-panel shape-panel">
      <button disabled={commonDisabled} onClick={() => insert('rectangle')}><IconRectangle />矩形</button>
      <button disabled={commonDisabled} onClick={() => insert('rounded')}><IconRoundedRect />圓角矩形</button>
      <button disabled={commonDisabled} onClick={() => insert('ellipse')}><IconEllipse />橢圓</button>
      <button disabled={commonDisabled} onClick={() => insert('line')}><IconLine />線條</button>
      <button disabled={commonDisabled} onClick={() => insert('arrow')}><IconArrow />箭頭</button>
      <button disabled={commonDisabled} onClick={() => insert('triangle')}><IconTriangle />三角形</button>
    </div>
  </details>;
  const pageMenu = <details className="command-menu page-menu" onToggle={closeSiblingMenus}>
    <summary><IconLayers />頁面</summary>
    <div className="command-menu-panel page-panel">
      <button disabled={commonDisabled || !editorDeckPosition} onClick={duplicateSlide}><IconDuplicate />建立副本</button>
      <button disabled={commonDisabled || !editorDeckPosition || editorDeckPosition.current === 0} onClick={() => reorderSlide(-1)}><IconMoveUp />前移</button>
      <button disabled={commonDisabled || !editorDeckPosition || editorDeckPosition.current === editorDeckPosition.total - 1} onClick={() => reorderSlide(1)}><IconMoveDown />後移</button>
      <button className="danger-text" disabled={commonDisabled || !editorDeckPosition || editorDeckPosition.total <= 1} onClick={deleteSlide}><IconDeletePage />移除頁面</button>
    </div>
  </details>;
  const paragraphMenu = <details className="command-menu paragraph-menu" onToggle={closeSiblingMenus}>
    <summary>段落</summary>
    <div className="command-menu-panel paragraph-panel">
      <button disabled={!textStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichCommand('strikeThrough')}>刪除線</button>
      <button disabled={!textStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichCommand('hiliteColor', '#FFF3A3')}>螢光標示</button>
      <button disabled={!textStyle} onClick={() => applyRichCommand('insertUnorderedList')}>項目符號</button>
      <button disabled={!textStyle} onClick={() => applyRichCommand('insertOrderedList')}>編號清單</button>
      <button disabled={!textStyle} onClick={() => applyRichCommand('indent')}>增加縮排</button>
      <button disabled={!textStyle} onClick={() => applyRichCommand('outdent')}>減少縮排</button>
    </div>
  </details>;

  return <main
    className="app-shell"
    onDragOver={(event) => event.preventDefault()}
    onDrop={handleDrop}
    onClick={(event) => {
      const command = (event.target as HTMLElement).closest('.command-menu-panel button');
      command?.closest('details')?.removeAttribute('open');
    }}
  >
    <GlobalBar
      identity={<div className="document-identity">
        <span className="product-mark" aria-hidden="true">H</span>
        <div>
          <h1>HTML Editor</h1>
          <p title={workspace?.entry}>{workspace?.entry ?? (runtimeMode === 'browser' ? '瀏覽器本機工作區 · 尚未開啟簡報' : '本機工作區 · 尚未開啟簡報')}</p>
        </div>
      </div>}
      actions={<>
        <button onClick={() => fileRef.current?.click()}><IconOpen />開啟檔案</button>
        <button className="global-import" onClick={() => fileRef.current?.click()}><IconImportZip />匯入 ZIP</button>
        <button disabled={!workspace || mode === 'presenter'} className={mode === 'preview' ? 'active' : ''} onClick={mode === 'preview' ? () => setMode('edit') : preview}><IconPreview />{mode === 'preview' ? '返回編輯' : '預覽'}</button>
        <button disabled={!workspace || mode !== 'edit'} className="primary" onClick={doExport}><IconExport />匯出</button>
      </>}
      overflow={<>
        <button disabled={!workspace} className={mode === 'presenter' ? 'active' : ''} onClick={mode === 'presenter' ? () => setMode('edit') : openPresenterView}><IconPresenter />{mode === 'presenter' ? '返回編輯' : '講者檢視'}</button>
        <button disabled={!workspace} onClick={doPrint}><IconPrint />列印</button>
        <button disabled={!workspace} onClick={() => restoreVersion()}><IconRestore />還原原始版本</button>
        <button disabled={!workspace || mode !== 'edit'} className={notesOpen ? 'active' : ''} onClick={() => { if (!speakerNotes) updateSpeakerNotes(Array.from({ length: editorDeckPosition?.total ?? 1 }, () => '')); setNotesOpen((open) => !open); }}><IconNotes />講者備註</button>
        <button disabled={!workspace || mode !== 'edit'} className={layersOpen ? 'active' : ''} onClick={() => setLayersOpen((open) => !open)}><IconLayers />圖層</button>
        {runtimeMode === 'browser' && <button className={storagePanelOpen ? 'active' : ''} onClick={() => setStoragePanelOpen((open) => !open)}><IconStorage />瀏覽器儲存</button>}
        <p className="global-overflow-note">進階功能集中於此；頁面與縮放狀態顯示在底部。</p>
      </>}
      hiddenInputs={<>
        <input ref={fileRef} hidden type="file" accept=".html,.htm,.zip" onChange={(event) => handleFile(event.target.files?.[0])} />
        <input ref={imageRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (imagePurposeRef.current === 'background') void setSlideBackgroundImage(file); else void addImage(file); imagePurposeRef.current = 'object'; event.target.value = ''; }} />
      </>}
    />
    {runtimeMode === 'browser' && storagePanelOpen && <section className="storage-panel" aria-label="瀏覽器儲存狀態">
      <div><strong>僅儲存在這個瀏覽器</strong><p>清除網站資料會刪除工作區；更換瀏覽器或裝置不會同步。HTML／ZIP 匯出檔才是可攜式備份，無痕模式可能無法可靠保存。</p></div>
      <dl><div><dt>儲存方式</dt><dd>{storageDiagnostics?.backend === 'indexeddb+opfs' ? 'IndexedDB + OPFS' : 'IndexedDB fallback'}</dd></div><div><dt>用量</dt><dd>{formatBytes(storageDiagnostics?.usage ?? null)} / {formatBytes(storageDiagnostics?.quota ?? null)}</dd></div><div><dt>持久儲存</dt><dd>{storageDiagnostics?.persisted ? '已允許' : '未允許／未知'}</dd></div><div><dt>上次匯出備份</dt><dd className={isExportStale(lastExportedAt) ? 'danger-text' : ''}>{formatRelativeTime(lastExportedAt)}</dd></div></dl>
      <div className="storage-actions"><button onClick={persistBrowserStorage}>要求持久儲存</button><button disabled={!workspace} onClick={doExport}>立即匯出備份</button><button className="danger-text" disabled={!workspace} onClick={removeBrowserWorkspace}>刪除目前工作區</button></div>
    </section>}
    {layersOpen && workspace && mode === 'edit' && <section className="layers-panel" aria-label="圖層面板">
      <div className="layers-panel-heading"><strong>圖層</strong><span>第 {(editorDeckPosition?.current ?? 0) + 1} 頁</span><button aria-label="關閉圖層面板" onClick={() => setLayersOpen(false)}>關閉</button></div>
      {layerItems.length === 0
        ? <p className="layers-empty">目前頁面沒有可選取的元素。</p>
        : <ul className="layers-list">{layerItems.map((item) => {
            const active = selectedRef.current.some((element) => layerKey(element) === item.key);
            return <li key={item.key} className={active ? 'active' : ''}>
              <button className="layers-item-select" onClick={() => selectLayer(item.key)}>{item.label}</button>
              <div className="layers-item-actions">
                <button aria-label="上移一層" onClick={() => moveLayer(item.key, 1)}>↑</button>
                <button aria-label="下移一層" onClick={() => moveLayer(item.key, -1)}>↓</button>
              </div>
            </li>;
          })}</ul>}
    </section>}
    <ContextualCommandBar
      className={workspace ? '' : 'is-empty'}
      context={commandContext}
      contextLabel={workspace ? commandContextLabel : '尚未開啟簡報'}
      scopeSwitcher={<div className="ribbon-tabs" role="tablist" aria-label="工具範圍">
        {(['home', 'insert', 'arrange', 'view'] as const).map((tab) => <button key={tab} className={ribbonTab === tab ? 'active' : ''} onClick={() => setRibbonTab(tab)}>{{ home: '常用', insert: '插入', arrange: '排列', view: '檢視' }[tab]}</button>)}
      </div>}
      pageSwitcher={editorDeckPosition && <div className="slide-switcher" aria-label="編輯頁面切換"><button disabled={editorDeckPosition.current === 0} onClick={() => changeEditorSlide(-1)}>上一頁</button><span>{editorDeckPosition.current + 1} / {editorDeckPosition.total}</span><button disabled={editorDeckPosition.current === editorDeckPosition.total - 1} onClick={() => changeEditorSlide(1)}>下一頁</button></div>}
      compactOverflow={<>
        {commandContext === 'slide' && <><button disabled={commonDisabled} onClick={() => insert('text')}><IconTextBox />文字方塊</button><button disabled={commonDisabled} onClick={() => insert('rectangle')}><IconRectangle />矩形</button><button disabled={commonDisabled || !editorDeckPosition} onClick={addSlide}><IconAddPage />新增頁面</button></>}
        {commandContext !== 'slide' && <><button disabled={commonDisabled} onClick={() => zOrder(1)}><IconMoveUp />上移一層</button><button disabled={commonDisabled} onClick={() => zOrder(-1)}><IconMoveDown />下移一層</button><button disabled={commonDisabled} onClick={copySelection}><IconCopy />複製</button><button disabled={commonDisabled} onClick={remove}><IconDelete />刪除</button></>}
        <button disabled={commonDisabled} onClick={() => history('undo')}><IconUndo />復原</button>
        <button disabled={commonDisabled} onClick={() => history('redo')}><IconRedo />重做</button>
      </>}
    >
        {ribbonTab === 'home' && <>
          {commandContext === 'slide' && <><div className="toolbar-group quick-access"><div className="toolbar-buttons"><button disabled={commonDisabled} onClick={() => insert('text')}><IconTextBox />文字方塊</button><button disabled={commonDisabled} onClick={() => { imagePurposeRef.current = 'object'; imageRef.current?.click(); }}><IconImage />圖片</button><button disabled={commonDisabled} onClick={() => insert('rectangle')}><IconRectangle />矩形</button><button disabled={commonDisabled || !editorDeckPosition} onClick={addSlide}><IconAddPage />新增頁面</button>{pageMenu}{alignmentMenu}</div></div></>}
          {commandContext === 'text' && <><div className="toolbar-group text-tools"><div className="toolbar-buttons rich-buttons"><button aria-label="粗體" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichCommand('bold')}><b>B</b></button><button aria-label="斜體" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichCommand('italic')}><i>I</i></button><button aria-label="底線" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichCommand('underline')}><u>U</u></button><select aria-label="局部字體" defaultValue={fontChoices[0].value} onChange={(event) => applyRichCommand('fontName', event.target.value)}>{fontChoices.map((choice) => <option key={choice.label} value={choice.value}>{choice.label}</option>)}</select><select aria-label="局部字號" defaultValue="16px" onChange={(event) => applyRichCommand('fontSize', event.target.value)}>{commonSizes.map((size) => <option key={size} value={`${size}px`}>{size}</option>)}</select><input aria-label="局部文字顏色" type="color" defaultValue="#172033" onChange={(event) => applyRichCommand('foreColor', event.target.value)} />{paragraphMenu}</div></div></>}
          {(commandContext === 'object' || commandContext === 'multi' || commandContext === 'group') && <><div className="toolbar-group"><div className="toolbar-buttons"><button disabled={commonDisabled} onClick={() => zOrder(1)}><IconMoveUp />上移一層</button><button disabled={commonDisabled} onClick={() => zOrder(-1)}><IconMoveDown />下移一層</button>{alignmentMenu}{groupMenu}<button disabled={commonDisabled} onClick={remove}><IconDelete />刪除</button></div></div></>}
          {restrictedReason && <div className="toolbar-group"><span className="toolbar-label">相容</span><div className="toolbar-buttons"><button className="warning" onClick={convertToFreePosition}><IconUnlock />轉為自由定位</button></div></div>}
          <div className="toolbar-group"><div className="toolbar-buttons"><button disabled={commonDisabled || selectedCount === 0} onClick={copySelection}><IconCopy />複製</button><button disabled={commonDisabled} onClick={pasteSelection}><IconPaste />貼上</button><button disabled={commonDisabled || selectedCount === 0} onClick={copyFormat}><IconFormatPainter />複製格式</button><button disabled={commonDisabled || selectedCount === 0 || !hasCopiedFormat} onClick={applyFormat}><IconFormatPainter />套用格式</button></div></div>
        </>}
        {ribbonTab === 'insert' && <>
          <div className="toolbar-group"><span className="toolbar-label">內容</span><div className="toolbar-buttons"><button disabled={commonDisabled} onClick={() => insert('text')}><IconTextBox />文字方塊</button><button disabled={commonDisabled} onClick={() => { imagePurposeRef.current = 'object'; imageRef.current?.click(); }}><IconImage />圖片</button></div></div>
          <div className="toolbar-group"><span className="toolbar-label">形狀</span><div className="toolbar-buttons">{shapeMenu}<button disabled={commonDisabled} onClick={() => insertTable()}><IconTable />表格</button></div></div>
          <div className="toolbar-group"><span className="toolbar-label">投影片</span><div className="toolbar-buttons"><button disabled={commonDisabled || !editorDeckPosition} onClick={addSlide}><IconAddPage />新增頁面</button>{pageMenu}</div></div>
        </>}
        {ribbonTab === 'arrange' && <>
          <div className="toolbar-group"><span className="toolbar-label">排列</span><div className="toolbar-buttons"><button disabled={commonDisabled} onClick={() => zOrder(1)}><IconMoveUp />上移一層</button><button disabled={commonDisabled} onClick={() => zOrder(-1)}><IconMoveDown />下移一層</button>{alignmentMenu}{groupMenu}</div></div>
          {(restrictedReason || isCompatibilityMode) && <div className="toolbar-group"><span className="toolbar-label">相容</span><div className="toolbar-buttons">{restrictedReason && <button className="warning" onClick={convertToFreePosition}><IconUnlock />解鎖元素</button>}<button onClick={unlockCurrentSlide}><IconUnlock />解鎖本頁</button></div></div>}
        </>}
        {ribbonTab === 'view' && <>
          <div className="toolbar-group"><span className="toolbar-label">輔助</span><div className="toolbar-buttons"><button className={gridEnabled ? 'active' : ''} onClick={() => setGridEnabled((value) => !value)}><IconGrid />格線</button><button className={guidesEnabled ? 'active' : ''} onClick={() => setGuidesEnabled((value) => !value)}><IconGuides />智慧參考線</button><button onClick={() => fitCanvas('slide')}><IconFitSlide />符合投影片</button><button onClick={() => fitCanvas('width')}><IconFitWidth />符合寬度</button></div></div>
          <div className="toolbar-group"><span className="toolbar-label">頁面設定</span><div className="toolbar-buttons"><button onClick={() => setSlideRatio('16:9')}><IconRatio />16:9</button><button onClick={() => setSlideRatio('4:3')}><IconRatio />4:3</button><input aria-label="投影片背景色" type="color" defaultValue="#ffffff" onChange={(event) => setSlideBackground(event.target.value)} /><button onClick={() => { imagePurposeRef.current = 'background'; imageRef.current?.click(); }}><IconBackgroundImage />背景圖片</button></div></div>
          <div className="toolbar-group"><span className="toolbar-label">復原版本</span><div className="toolbar-buttons"><button disabled={!workspace} onClick={() => restoreVersion()}><IconRestore />還原原始版本</button><select aria-label="快照" defaultValue="" onChange={(event) => { if (event.target.value) void restoreVersion(event.target.value); }}><option value="">選擇快照</option>{snapshots.map((item) => <option key={item.id} value={item.id}>{item.createdAt}</option>)}</select></div></div>
        </>}
        <div className="toolbar-group history-controls"><div className="toolbar-buttons"><button disabled={commonDisabled} onClick={() => history('undo')}><IconUndo />復原</button><button disabled={commonDisabled} onClick={() => history('redo')}><IconRedo />重做</button></div></div>
    </ContextualCommandBar>
    <section className="workspace-layout" data-viewport={viewportMode} data-inspector-open={inspectorOpen} data-rail-drawer-open={railDrawerOpen}>
      {workspace && mode === 'edit' && <SlideRail
        slides={slideSummaries}
        currentIndex={editorDeckPosition?.current ?? 0}
        collapsed={railCollapsed}
        drawerOpen={railDrawerOpen}
        viewport={viewportMode}
        width={railWidth}
        toggleRef={railPanelToggleRef}
        onToggleCollapsed={() => setRailCollapsed((value) => !value)}
        onToggleDrawer={() => setRailDrawerOpen((value) => !value)}
        onSelect={showEditorSlide}
        onDuplicate={(index) => { showEditorSlide(index); duplicateSlide(); }}
        onDelete={(index) => { showEditorSlide(index); deleteSlide(); }}
        onAdd={addSlide}
        onResize={setRailWidth}
      />}
      {workspace && mode === 'edit' && <div className="workspace-panel-toggles">
        <button ref={railPanelToggleRef} className={railDrawerOpen ? 'active' : ''} aria-expanded={railDrawerOpen} aria-controls="slide-rail" onClick={() => { setInspectorOpen(false); setRailDrawerOpen((value) => !value); }}>投影片</button>
        <button ref={inspectorPanelToggleRef} className={inspectorOpen ? 'active' : ''} aria-expanded={inspectorOpen} aria-controls="inspector-panel" onClick={() => { setRailDrawerOpen(false); setInspectorOpen((value) => !value); }}>屬性</button>
      </div>}
      {viewportMode !== 'desktop' && (railDrawerOpen || inspectorOpen) && <button className="panel-backdrop" aria-label="關閉側邊面板" onClick={() => { setRailDrawerOpen(false); setInspectorOpen(false); }} />}
      <section className="editor-surface">
        <section ref={workspaceRef} className="workspace">
          {!workspace && <div className="empty"><div className="empty-icon">HTML</div><h2>開啟你的簡報</h2><p>支援單一 HTML、拖放檔案，以及包含 CSS、JavaScript、圖片的 ZIP 專案。</p><button className="primary large" onClick={() => fileRef.current?.click()}>選擇檔案</button><p className="privacy">{runtimeMode === 'browser' ? '檔案只保存在這個瀏覽器，不會自動上傳；清除網站資料會刪除工作區。請用 HTML／ZIP 匯出做可攜式備份。' : '檔案只送到你電腦上的本機服務，不會上傳雲端。'}</p></div>}
          {workspace && <iframe ref={iframeRef} title="簡報編輯畫布" className="canvas-frame" style={{ display: mode === 'edit' ? 'block' : 'none' }} sandbox="allow-same-origin allow-scripts" srcDoc={workspace.html} onLoad={bindEditor} />}
          {workspace && mode === 'preview' && <iframe title="簡報執行預覽" className="canvas-frame" sandbox="allow-scripts allow-popups" src={workspace.previewHtml ? undefined : `/api/workspaces/${workspace.id}/preview`} srcDoc={workspace.previewHtml} />}
          {workspace && mode === 'presenter' && <section className="presenter-view" aria-label="安全講者檢視">
            <iframe title="講者檢視簡報" className="presenter-frame" sandbox="allow-scripts" src={workspace.previewHtml ? undefined : `/api/workspaces/${workspace.id}/preview`} srcDoc={workspace.previewHtml} />
            <aside className="presenter-console">
              <div className="presenter-timer"><span>{formatElapsed(presenterElapsedMs)}</span><button onClick={() => { presenterStartRef.current = Date.now(); setPresenterElapsedMs(0); }}>重設計時</button></div>
              <p className="eyebrow">PRESENTER NOTES</p>
              <h2>第 {presenterIndex + 1} 頁講稿</h2>
              <div className="presenter-note">{speakerNotes?.[presenterIndex] || '這一頁尚無講者備註。'}</div>
              {slideSummaries[presenterIndex + 1] && <div className="presenter-next"><span className="presenter-next-label">下一頁預覽</span><iframe title="下一頁預覽" className="presenter-next-thumb" srcDoc={slideSummaries[presenterIndex + 1].preview} /></div>}
              <div className="presenter-controls"><button disabled={presenterIndex === 0} onClick={() => setPresenterIndex((index) => Math.max(0, index - 1))}>上一頁講稿</button><span>{presenterIndex + 1} / {speakerNotes?.length ?? 0}</span><button disabled={presenterIndex >= (speakerNotes?.length ?? 1) - 1} onClick={() => setPresenterIndex((index) => Math.min((speakerNotes?.length ?? 1) - 1, index + 1))}>下一頁講稿</button></div>
              <p className="presenter-hint">簡報畫面與講稿皆在本機；請使用簡報內控制與講稿頁碼同步。</p>
            </aside>
          </section>}
        </section>
        {workspace && mode === 'edit' && notesOpen && speakerNotes && <section className="speaker-notes" aria-label="講者備註面板">
          <div className="speaker-notes-heading"><div><strong>講者備註</strong><span>第 {(editorDeckPosition?.current ?? 0) + 1} 頁</span></div><button aria-label="關閉講者備註" onClick={() => setNotesOpen(false)}>關閉</button></div>
          <textarea aria-label="目前頁面講者備註" value={speakerNotes[editorDeckPosition?.current ?? 0] ?? ''} onFocus={() => { notesBeforeRef.current = speakerNotesRef.current ? [...speakerNotesRef.current] : null; }} onChange={(event) => {
             const index = editorDeckPosition?.current ?? 0;
            updateSpeakerNotes(speakerNotes.map((note, noteIndex) => noteIndex === index ? event.target.value : note));
          }} onBlur={() => {
            if (notesBeforeRef.current) commit(snapshot(), true, notesBeforeRef.current);
            notesBeforeRef.current = null;
          }} placeholder="這一頁尚無講者備註。" />
        </section>}
      </section>
      {workspace && mode === 'edit' && textStyle && <InspectorShell
        title={selectedCount > 1 ? `已選取 ${selectedCount} 個物件` : '文字'}
        eyebrow={selectedCount > 1 ? '多重選取' : '文字屬性'}
        summary={<>第 {(editorDeckPosition?.current ?? 0) + 1} 頁 · {selectedTextCount > 1 ? `${selectedTextCount} 個文字元素` : '可自由編輯'}</>}
        actions={<span>{selectedCount > 1 ? '批次套用共用文字格式' : '文字與位置'}</span>}
        className="text-inspector"
        tab={inspectorTab}
        drawerOpen={inspectorOpen}
        viewport={viewportMode}
        onClose={() => setInspectorOpen(false)}
      >
        <div className="inspector-tabs"><button className={inspectorTab === 'format' ? 'active' : ''} onClick={() => setInspectorTab('format')}>格式</button><button className={inspectorTab === 'position' ? 'active' : ''} onClick={() => setInspectorTab('position')}>位置</button></div>
        <InspectorSection title="文字" meta="字體與排版" className="format-section">
          <div className="property-row"><span>字體</span><select aria-label="字體" value={textStyle.fontFamily} onChange={(event) => applyTextStyle('font-family', event.target.value)}>
            {!fontChoices.some((choice) => choice.value === textStyle.fontFamily) && <option value={textStyle.fontFamily}>{textStyle.fontFamily.split(',')[0].replaceAll('"', '').trim() || '來源字體'}</option>}
            {fontChoices.map((choice) => <option key={choice.label} value={choice.value}>{choice.label}</option>)}
            {fontFamilies.filter((family) => family !== textStyle.fontFamily && !fontChoices.some((choice) => choice.value === family)).map((family) => <option key={family} value={family}>{family.split(',')[0].replaceAll('"', '').trim()}</option>)}
          </select></div>
          <div className="property-row"><span>字號</span><div className="field-row"><select aria-label="常用字號" value={commonSizes.includes(textStyle.fontSize) ? textStyle.fontSize : ''} onChange={(event) => applyFontSize(Number(event.target.value))}><option value="" disabled>常用值</option>{commonSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select><input aria-label="精確字號" type="number" min="8" max="240" step="1" value={textStyle.fontSize} onChange={(event) => applyFontSize(Number(event.target.value))} /></div></div>
          <div className="property-row stacked"><span>字重</span><div className="segmented four">{weights.map((weight) => <button key={weight.value} className={textStyle.fontWeight === weight.value ? 'selected' : ''} onClick={() => applyTextStyle('font-weight', weight.value)}>{weight.label}</button>)}</div></div>
          <div className="property-row stacked"><span>對齊</span><div className="segmented">{alignments.map((alignment) => <button key={alignment.value} className={textStyle.textAlign === alignment.value ? 'selected' : ''} onClick={() => applyTextStyle('text-align', alignment.value)}>{alignment.label}</button>)}</div></div>
        </InspectorSection>
        <InspectorSection title="文字顏色" meta={textStyle.color} className="format-section color-section">
          <div className="palette">{palette.map((color) => <button key={color} type="button" aria-label={`色票 ${color}`} className={textStyle.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => applyColor(color)} />)}</div>
          <div className="field-row"><input aria-label="自訂 HEX" value={colorDraft} onChange={(event) => setColorDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyColor(colorDraft); }} /><button onClick={() => applyColor(colorDraft)}>套用</button></div>
          <div className="color-custom-row"><input aria-label="自訂顏色" type="color" value={/^#[\da-f]{6}$/i.test(colorDraft) ? colorDraft : '#000000'} onChange={(event) => applyColor(event.target.value.toUpperCase())} /><span className="color-custom-label">自訂顏色</span></div>
          {recentColors.length > 0 && <div className="recent-palette" aria-label="Recent text colors">{recentColors.map((color) => <button key={color} type="button" aria-label={`Recent color ${color}`} className="recent-color" style={{ background: color }} onClick={() => applyColor(color)} />)}</div>}
        </InspectorSection>
        <InspectorSection title="進階文字" meta="有限支援" advanced className="format-section">
          <div className="property-row"><span>行高</span><div className="field-row"><input aria-label="行高滑桿" type="range" min="0.8" max="3" step="0.05" value={textStyle.lineHeight} onPointerDown={beginLineChange} onChange={(event) => { beginLineChange(); applyLineHeight(Number(event.target.value), false); }} onPointerUp={finishLineChange} onKeyUp={finishLineChange} onBlur={finishLineChange} /><input aria-label="精確行高" type="number" min="0.8" max="3" step="0.05" value={textStyle.lineHeight} onChange={(event) => applyLineHeight(Number(event.target.value))} /></div></div>
          <FieldGrid><label>段落間距<input aria-label="段落間距" type="number" min="0" max="160" defaultValue="0" onChange={(event) => applyTextStyle('padding-bottom', `${event.target.value}px`)} /></label><label>內距<input aria-label="文字方塊內距" type="number" min="0" max="160" defaultValue={Number.parseFloat(selectedTarget?.style.padding ?? '0') || 0} onChange={(event) => applyTextStyle('padding', `${event.target.value}px`)} /></label></FieldGrid>
          <div className="property-row"><span>垂直對齊</span><select aria-label="垂直對齊" defaultValue="top" onChange={(event) => applyObjectStyle(event.target.value === 'top' ? { display: 'block' } : { display: 'flex', 'flex-direction': 'column', 'justify-content': event.target.value === 'middle' ? 'center' : 'flex-end' })}><option value="top">靠上</option><option value="middle">置中</option><option value="bottom">靠下</option></select></div>
        </InspectorSection>
        <InspectorSection title="位置與尺寸" className="position-panel"><FieldGrid><label>X<input type="number" value={Math.round(Number.parseFloat(selectedTarget?.style.left ?? '0') || selectedTarget?.offsetLeft || 0)} onChange={(event) => setObjectPosition('left', Number(event.target.value))} /></label><label>Y<input type="number" value={Math.round(Number.parseFloat(selectedTarget?.style.top ?? '0') || selectedTarget?.offsetTop || 0)} onChange={(event) => setObjectPosition('top', Number(event.target.value))} /></label><label>寬<input type="number" value={Math.round(Number.parseFloat(selectedTarget?.style.width ?? '0') || selectedTarget?.offsetWidth || 0)} onChange={(event) => setObjectPosition('width', Number(event.target.value))} /></label><label>高<input type="number" value={Math.round(Number.parseFloat(selectedTarget?.style.height ?? '0') || selectedTarget?.offsetHeight || 0)} onChange={(event) => setObjectPosition('height', Number(event.target.value))} /></label></FieldGrid><div className="property-row"><span>旋轉</span><input type="number" value={Number(selectedTarget?.dataset.editorRotation ?? 0)} onChange={(event) => setRotation(Number(event.target.value))} /></div></InspectorSection>
      </InspectorShell>}
      {workspace && mode === 'edit' && !textStyle && selectedTarget && <InspectorShell
        title={selectedCount > 1 ? `已選取 ${selectedCount} 個物件` : selectedTarget.dataset.editorKind === 'group' ? '群組' : selectedTarget.dataset.editorKind === 'decoration' ? '裝飾條' : selectedIsImage ? '圖片' : selectedIsShape ? '形狀' : '物件'}
        eyebrow={selectedCount > 1 ? '多重選取' : selectedTarget.dataset.editorKind === 'group' ? '群組屬性' : '物件屬性'}
        summary={<>第 {(editorDeckPosition?.current ?? 0) + 1} 頁 · {selectedCount > 1 ? '共用屬性' : '可自由編輯'}</>}
        className="text-inspector object-inspector"
        tab={inspectorTab}
        drawerOpen={inspectorOpen}
        viewport={viewportMode}
        onClose={() => setInspectorOpen(false)}
      >
        <div className="inspector-tabs"><button className={inspectorTab === 'format' ? 'active' : ''} onClick={() => setInspectorTab('format')}>外觀</button><button className={inspectorTab === 'position' ? 'active' : ''} onClick={() => setInspectorTab('position')}>位置</button></div>
        {(selectedCount > 1 || selectedTarget.dataset.editorKind === 'group') && <InspectorSection title={selectedTarget.dataset.editorKind === 'group' ? '群組' : '對齊與分布'} className="format-section"><div className="inspector-action-grid">{alignmentMenu}{groupMenu}<button onClick={() => zOrder(1)}>上移一層</button><button onClick={() => zOrder(-1)}>下移一層</button></div></InspectorSection>}
        {!selectedIsTable && <InspectorSection title="填滿與外觀" className="object-format format-section"><div className="property-row"><span>填滿</span><input aria-label="填滿色" type="color" defaultValue="#5b7cfa" onChange={(event) => applyObjectStyle({ 'background-color': event.target.value })} /></div><div className="property-row"><span>框線</span><input aria-label="框線色" type="color" defaultValue="#3659d9" onChange={(event) => applyObjectStyle({ 'border-color': event.target.value })} /></div><FieldGrid><label>框線寬<input type="number" min="0" max="30" defaultValue="2" onChange={(event) => applyObjectStyle({ 'border-width': `${event.target.value}px`, 'border-style': 'solid' })} /></label><label>樣式<select defaultValue="solid" onChange={(event) => applyObjectStyle({ 'border-style': event.target.value })}><option value="solid">實線</option><option value="dashed">虛線</option><option value="dotted">點線</option></select></label></FieldGrid><div className="property-row"><span>不透明度</span><input type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={(event) => applyObjectStyle({ opacity: event.target.value })} /></div><div className="property-row"><span>圓角</span><input type="range" min="0" max="100" defaultValue="0" onChange={(event) => applyObjectStyle({ 'border-radius': `${event.target.value}px` })} /></div></InspectorSection>}
        {selectedIsTable && <InspectorSection title="表格" meta="雙擊儲存格編輯" className="format-section">
          <div className="inspector-action-grid">
            <button onClick={() => modifyTable('add-row')}>新增列</button>
            <button onClick={() => modifyTable('remove-row')}>刪除列</button>
            <button onClick={() => modifyTable('add-column')}>新增欄</button>
            <button onClick={() => modifyTable('remove-column')}>刪除欄</button>
          </div>
        </InspectorSection>}
        {selectedHoldsText && <InspectorSection title="文字" meta="雙擊形狀可編輯" className="format-section">
          <FieldGrid><label>字號<input type="number" min="8" max="240" value={Math.round(Number.parseFloat(selectedTarget.style.fontSize) || 20)} onChange={(event) => applyObjectStyle({ 'font-size': `${event.target.value}px` })} /></label><label>文字色<input aria-label="形狀文字顏色" type="color" value={toHexColor(selectedTarget.style.color, '#ffffff')} onChange={(event) => applyObjectStyle({ color: event.target.value })} /></label></FieldGrid>
          <div className="property-row stacked"><span>水平位置</span><div className="segmented">{([['flex-start', '靠左'], ['center', '置中'], ['flex-end', '靠右']] as const).map(([value, label]) => <button key={value} className={(selectedTarget.style.justifyContent || 'center') === value ? 'selected' : ''} onClick={() => applyObjectStyle({ display: 'flex', 'justify-content': value })}>{label}</button>)}</div></div>
          <div className="property-row stacked"><span>垂直位置</span><div className="segmented">{([['flex-start', '靠上'], ['center', '置中'], ['flex-end', '靠下']] as const).map(([value, label]) => <button key={value} className={(selectedTarget.style.alignItems || 'center') === value ? 'selected' : ''} onClick={() => applyObjectStyle({ display: 'flex', 'align-items': value })}>{label}</button>)}</div></div>
        </InspectorSection>}
        {selectedIsImage && <InspectorSection title="圖片" className="format-section"><div className="property-row"><span>模式</span><select defaultValue={selectedTarget.style.objectFit || 'contain'} onChange={(event) => applyObjectStyle({ 'object-fit': event.target.value })}><option value="contain">符合</option><option value="cover">填滿／裁切</option><option value="fill">拉伸</option></select></div><div className="property-row"><span>焦點</span><select defaultValue={selectedTarget.style.objectPosition || '50% 50%'} onChange={(event) => applyObjectStyle({ 'object-position': event.target.value })}><option value="50% 50%">置中</option><option value="50% 0%">靠上</option><option value="50% 100%">靠下</option><option value="0% 50%">靠左</option><option value="100% 50%">靠右</option></select></div><div className="property-row"><span>鎖定比例</span><button type="button" role="switch" aria-checked={selectedTarget.dataset.editorLockAspect === 'true'} aria-label="鎖定圖片比例" className={`toggle-switch ${selectedTarget.dataset.editorLockAspect === 'true' ? 'active' : ''}`} onClick={() => setLockAspect(selectedTarget.dataset.editorLockAspect !== 'true')}><span className="toggle-thumb" /></button></div><div className="inspector-action-grid"><button onClick={() => imageRef.current?.click()}>替換圖片</button><button onClick={() => flipSelected('x')}>水平翻轉</button><button onClick={() => flipSelected('y')}>垂直翻轉</button></div></InspectorSection>}
        <InspectorSection title="位置與尺寸" className="position-panel"><FieldGrid><label>X<input type="number" value={Math.round(Number.parseFloat(selectedTarget.style.left) || selectedTarget.offsetLeft || 0)} onChange={(event) => setObjectPosition('left', Number(event.target.value))} /></label><label>Y<input type="number" value={Math.round(Number.parseFloat(selectedTarget.style.top) || selectedTarget.offsetTop || 0)} onChange={(event) => setObjectPosition('top', Number(event.target.value))} /></label><label>寬<input type="number" value={Math.round(Number.parseFloat(selectedTarget.style.width) || selectedTarget.offsetWidth || 0)} onChange={(event) => setObjectPosition('width', Number(event.target.value))} /></label><label>高<input type="number" value={Math.round(Number.parseFloat(selectedTarget.style.height) || selectedTarget.offsetHeight || 0)} onChange={(event) => setObjectPosition('height', Number(event.target.value))} /></label></FieldGrid><div className="property-row"><span>旋轉</span><input type="number" value={Number(selectedTarget.dataset.editorRotation ?? 0)} onChange={(event) => setRotation(Number(event.target.value))} /></div></InspectorSection>
        <InspectorSection title="進階" meta="有限支援" advanced className="format-section"><div className="property-row"><span>陰影</span><select defaultValue="none" onChange={(event) => applyObjectStyle({ 'box-shadow': event.target.value })}><option value="none">無</option><option value="0 10px 28px rgba(15,23,42,.22)">柔和</option><option value="0 18px 48px rgba(15,23,42,.34)">強烈</option></select></div><div className="property-row"><span>動畫</span><select defaultValue={selectedTarget.dataset.editorAnimation ?? 'none'} onChange={(event) => setAnimation(event.target.value as 'none' | 'fade' | 'rise')}><option value="none">無</option><option value="fade">淡入</option><option value="rise">浮入</option></select></div></InspectorSection>
      </InspectorShell>}
      {workspace && mode === 'edit' && !textStyle && !selectedTarget && <InspectorShell
        title="投影片"
        eyebrow="未選取物件"
        summary={<>第 {(editorDeckPosition?.current ?? 0) + 1} / {editorDeckPosition?.total ?? 1} 頁</>}
        className="inspector-spacer"
        drawerOpen={inspectorOpen}
        viewport={viewportMode}
        onClose={() => setInspectorOpen(false)}
      >
        <InspectorSection title="投影片設定" meta="畫布"><div className="inspector-action-grid"><button onClick={() => setSlideRatio('16:9')}>設為 16:9</button><button onClick={() => setSlideRatio('4:3')}>設為 4:3</button><button onClick={() => { imagePurposeRef.current = 'background'; imageRef.current?.click(); }}>背景圖片</button><button onClick={() => setRibbonTab('view')}>更多檢視設定</button></div></InspectorSection>
        <InspectorSection title="快速插入"><div className="inspector-action-grid"><button onClick={() => insert('text')}>新增文字方塊</button><button onClick={() => { imagePurposeRef.current = 'object'; imageRef.current?.click(); }}>新增圖片</button><button onClick={() => insert('rectangle')}>新增形狀</button><button onClick={addSlide}>新增投影片</button></div></InspectorSection>
        <InspectorSection title="輔助與版本" meta="不變更文件內容" advanced><div className="inspector-action-grid"><button className={gridEnabled ? 'active' : ''} onClick={() => setGridEnabled((value) => !value)}>格線</button><button className={guidesEnabled ? 'active' : ''} onClick={() => setGuidesEnabled((value) => !value)}>智慧參考線</button><button disabled={!workspace} onClick={() => restoreVersion()}>還原原始版本</button></div></InspectorSection>
        <InspectorSection title="快捷鍵" meta="隨時可用">
          <div className="inspector-quick-help">
            <strong>選取</strong>
            <span>切換下一個元素</span><span>Tab</span>
            <span>選取聚焦元素</span><span>Enter</span>
            <strong>編輯</strong>
            <span>複製</span><span>Ctrl/⌘+C</span>
            <span>貼上</span><span>Ctrl/⌘+V</span>
            <span>直接複製一份</span><span>Ctrl/⌘+D</span>
            <span>刪除</span><span>Delete</span>
            <strong>群組與歷史</strong>
            <span>組成群組</span><span>Ctrl/⌘+G</span>
            <span>解散群組</span><span>Ctrl/⌘+Shift+G</span>
            <span>復原</span><span>Ctrl/⌘+Z</span>
            <span>重做</span><span>Ctrl/⌘+Shift+Z</span>
            <strong>微調位置</strong>
            <span>移動 1px</span><span>方向鍵</span>
            <span>移動 10px</span><span>Shift+方向鍵</span>
          </div>
        </InspectorSection>
      </InspectorShell>}
    </section>
    <footer className="status-bar">
      <section className={`status-source ${notice.type}`} role="status">
        <span className="status-origin">{selectedCount ? `已選取 ${selectedCount} 個元素` : workspace ? `來源：${workspace.entry}` : '尚未開啟簡報'}</span>
        <span className="status-message">{notice.text}</span>
        {workspace && <span className={`status-mode ${isCompatibilityMode ? 'mixed' : workspace.compatibility.level.toLowerCase()}`}>{compatibilityLabel}</span>}
        {workspace && <span className={`status-save ${autosaveState}`}>{autosaveState === 'saving' ? '儲存中…' : autosaveState === 'error' ? '儲存失敗' : '已儲存'}</span>}
      </section>
      {workspace && <>
      <span className="status-page">第 {(editorDeckPosition?.current ?? 0) + 1} / {editorDeckPosition?.total ?? 1} 頁</span>
      <div className="zoom-control"><button aria-label="縮小" onClick={() => setZoomLevel(zoom - 10)}>−</button><input aria-label="縮放" type="range" min="25" max="200" value={zoom} onChange={(event) => setZoomLevel(Number(event.target.value))} /><button aria-label="放大" onClick={() => setZoomLevel(zoom + 10)}>＋</button><span>{zoom}%</span></div>
      </>}
    </footer>
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onMouseLeave={() => setContextMenu(null)}>{(['copy', 'paste', 'bring-forward', 'send-backward', 'delete'] as CommandId[]).map((id) => <button key={id} onClick={() => { runCommand(id); setContextMenu(null); }}>{commandRegistry[id].label}{commandRegistry[id].shortcut ? <small>{commandRegistry[id].shortcut}</small> : null}</button>)}</div>}
  </main>;
}
