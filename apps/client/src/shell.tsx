import type { CSSProperties, ReactNode, RefObject } from 'react';
import { IconDelete, IconMoreTools } from './icons';

export type CommandContext = 'slide' | 'text' | 'object' | 'multi' | 'group';
export type ShellViewport = 'desktop' | 'compact' | 'drawer';

export type SlideSummary = {
  key: string;
  title: string;
  index: number;
  preview: string;
};

type GlobalBarProps = {
  identity: ReactNode;
  actions: ReactNode;
  overflow: ReactNode;
  hiddenInputs: ReactNode;
};

export function GlobalBar({ identity, actions, overflow, hiddenInputs }: GlobalBarProps) {
  return <header className="topbar global-bar">
    {identity}
    <div className="global-actions">
      {actions}
      <details className="command-menu global-overflow">
        <summary aria-label="更多全域功能"><IconMoreTools />更多</summary>
        <div className="command-menu-panel global-overflow-panel">{overflow}</div>
      </details>
      {hiddenInputs}
    </div>
  </header>;
}

type ContextualCommandBarProps = {
  context: CommandContext;
  contextLabel: string;
  scopeSwitcher: ReactNode;
  children: ReactNode;
  compactOverflow: ReactNode;
  pageSwitcher?: ReactNode;
  className?: string;
};

export function ContextualCommandBar({
  context,
  contextLabel,
  scopeSwitcher,
  children,
  compactOverflow,
  pageSwitcher,
  className = '',
}: ContextualCommandBarProps) {
  return <nav className={`ribbon contextual-command-bar ${className}`} data-command-context={context} aria-label="情境工具列">
    <div className="ribbon-content">
      <div className="command-context">
        <span className="command-context-kicker">目前情境</span>
        <strong>{contextLabel}</strong>
      </div>
      {scopeSwitcher}
      <div className="contextual-commands">{children}</div>
      <details className="command-menu compact-command-overflow">
        <summary aria-label="開啟工具溢位選單"><IconMoreTools />工具</summary>
        <div className="command-menu-panel compact-command-overflow-panel">{compactOverflow}</div>
      </details>
      <span className="toolbar-spacer" />
      {pageSwitcher}
    </div>
  </nav>;
}

type SlideRailProps = {
  slides: SlideSummary[];
  currentIndex: number;
  collapsed: boolean;
  drawerOpen: boolean;
  viewport: ShellViewport;
  width: number;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggleCollapsed: () => void;
  onToggleDrawer: () => void;
  onSelect: (index: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  onResize: (width: number) => void;
};

export function SlideRail({
  slides,
  currentIndex,
  collapsed,
  drawerOpen,
  viewport,
  width,
  toggleRef,
  onToggleCollapsed,
  onToggleDrawer,
  onSelect,
  onDuplicate,
  onDelete,
  onAdd,
  onResize,
}: SlideRailProps) {
  const compact = viewport === 'compact' ? !drawerOpen : viewport === 'desktop' ? collapsed : false;
  const railStyle = { '--rail-width': `${width}px` } as CSSProperties;
  return <aside
    id="slide-rail"
    className={`slide-rail ${compact ? 'collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''}`}
    style={railStyle}
    aria-label="投影片縮圖"
    aria-hidden={viewport === 'drawer' && !drawerOpen}
  >
    <div className="slide-rail-heading">
      <div>
        <strong>{compact ? '頁面' : '投影片'}</strong>
        {!compact && <span>{slides.length} 頁</span>}
      </div>
      {viewport === 'desktop'
        ? <button ref={toggleRef} aria-label={collapsed ? '展開縮圖列' : '收合縮圖列'} onClick={onToggleCollapsed}>{collapsed ? '›' : '‹'}</button>
        : <button aria-label={drawerOpen ? '關閉投影片抽屜' : '展開投影片抽屜'} onClick={onToggleDrawer}>{drawerOpen ? '×' : '›'}</button>}
      <button aria-label="快速新增" onClick={onAdd}>＋</button>
    </div>
    <div className="slide-list">
      {slides.map((slide) => <article key={slide.key} className={`slide-item ${slide.index === currentIndex ? 'active' : ''}`}>
        <button
          className="slide-select"
          onClick={() => onSelect(slide.index)}
          aria-label={`編輯第 ${slide.index + 1} 頁：${slide.title}`}
          aria-current={slide.index === currentIndex ? 'page' : undefined}
        >
          <span className="slide-number">{slide.index + 1}</span>
          {!compact && <span className="slide-thumb"><iframe title={`第 ${slide.index + 1} 頁即時縮圖`} sandbox="allow-same-origin" srcDoc={slide.preview} style={{ transform: `scale(${Math.max(0.06, (width - 36) / 1600)})` }} /></span>}
        </button>
        {!compact && <div className="slide-actions">
          <button aria-label={`建立第 ${slide.index + 1} 頁副本`} title="建立副本" onClick={() => onDuplicate(slide.index)}>複製</button>
          <button aria-label={`移除第 ${slide.index + 1} 頁`} title="移除頁面" disabled={slides.length <= 1} onClick={() => onDelete(slide.index)}><IconDelete /></button>
        </div>}
      </article>)}
    </div>
    {!compact && <input className="rail-resizer" aria-label="縮圖列寬度" type="range" min="176" max="260" value={width} onChange={(event) => onResize(Number(event.target.value))} />}
  </aside>;
}

type InspectorShellProps = {
  title: string;
  eyebrow: string;
  summary: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tab?: 'format' | 'position';
  drawerOpen: boolean;
  viewport: ShellViewport;
  onClose: () => void;
};

export function InspectorShell({
  title,
  eyebrow,
  summary,
  actions,
  children,
  className = '',
  tab,
  drawerOpen,
  viewport,
  onClose,
}: InspectorShellProps) {
  const accessibleName = title === '文字' || title.startsWith('已選取')
    ? '文字格式'
    : title === '投影片'
      ? '投影片屬性'
      : '物件格式';
  return <aside
    id="inspector-panel"
    className={`inspector-shell ${className} ${drawerOpen ? 'drawer-open' : ''}`}
    data-inspector-tab={tab}
    data-viewport={viewport}
    aria-label={accessibleName}
    aria-hidden={!drawerOpen}
  >
    <header className="inspector-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <div className="context-meta">{summary}</div>
      </div>
      <div className="inspector-heading-actions">
        {actions}
        <button type="button" aria-label={`關閉${accessibleName}`} onClick={onClose}>×</button>
      </div>
    </header>
    {children}
  </aside>;
}

type InspectorSectionProps = {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  advanced?: boolean;
  defaultOpen?: boolean;
  className?: string;
};

export function InspectorSection({
  title,
  meta,
  children,
  advanced = false,
  defaultOpen = false,
  className = '',
}: InspectorSectionProps) {
  if (advanced) {
    return <details className={`inspector-section inspector-advanced ${className}`} open={defaultOpen || undefined}>
      <summary><span>{title}</span>{meta && <small>{meta}</small>}</summary>
      <div className="inspector-section-body">{children}</div>
    </details>;
  }
  return <section className={`inspector-section ${className}`}>
    <header><strong>{title}</strong>{meta && <small>{meta}</small>}</header>
    <div className="inspector-section-body">{children}</div>
  </section>;
}

export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return <div className={`property-grid columns-${columns}`}>{children}</div>;
}
