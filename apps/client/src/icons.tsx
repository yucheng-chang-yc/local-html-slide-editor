import type { ReactNode } from 'react';

type IconProps = { className?: string };

const base = (children: ReactNode, className?: string) => (
  <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

// --- Insert / shapes ---
export const IconTextBox = ({ className }: IconProps) => base(<>
  <path d="M3 5h14" />
  <path d="M10 5v10" />
  <path d="M7 15h6" />
</>, className);

export const IconImage = ({ className }: IconProps) => base(<>
  <rect x="3" y="4" width="14" height="12" rx="1.5" />
  <circle cx="7.2" cy="8.2" r="1.2" />
  <path d="M4 14.5l4-4 3 3 2.5-2.5 3.5 3.5" />
</>, className);

export const IconRectangle = ({ className }: IconProps) => base(<rect x="3.5" y="5" width="13" height="10" rx="0.5" />, className);

export const IconRoundedRect = ({ className }: IconProps) => base(<rect x="3.5" y="5" width="13" height="10" rx="3.5" />, className);

export const IconEllipse = ({ className }: IconProps) => base(<ellipse cx="10" cy="10" rx="6.5" ry="5" />, className);

export const IconLine = ({ className }: IconProps) => base(<path d="M4 16l12-12" />, className);

export const IconArrow = ({ className }: IconProps) => base(<>
  <path d="M3.5 10h11" />
  <path d="M10.5 6l4 4-4 4" />
</>, className);

export const IconTriangle = ({ className }: IconProps) => base(<path d="M10 4l7 12H3z" />, className);

export const IconAddPage = ({ className }: IconProps) => base(<>
  <rect x="4" y="3" width="9" height="12" rx="1" />
  <path d="M14 9h3M15.5 7.5v3" />
</>, className);

export const IconDuplicate = ({ className }: IconProps) => base(<>
  <rect x="6" y="6" width="9" height="11" rx="1" />
  <path d="M4 12.5V4a1 1 0 0 1 1-1h8.5" />
</>, className);

export const IconMoveUp = ({ className }: IconProps) => base(<>
  <rect x="6.5" y="6.5" width="9" height="9" rx="1" opacity="0.45" />
  <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
</>, className);

export const IconMoveDown = ({ className }: IconProps) => base(<>
  <rect x="3.5" y="3.5" width="9" height="9" rx="1" opacity="0.45" />
  <rect x="6.5" y="6.5" width="9" height="9" rx="1" />
</>, className);

export const IconDeletePage = ({ className }: IconProps) => base(<>
  <rect x="4" y="3" width="9" height="12" rx="1" />
  <path d="M13.5 7.5l4 4M17.5 7.5l-4 4" />
</>, className);

export const IconUndo = ({ className }: IconProps) => base(<>
  <path d="M5 8H12a4 4 0 0 1 0 8h-2" />
  <path d="M8 4.5L4.5 8 8 11.5" />
</>, className);

export const IconRedo = ({ className }: IconProps) => base(<>
  <path d="M15 8H8a4 4 0 0 0 0 8h2" />
  <path d="M12 4.5L15.5 8 12 11.5" />
</>, className);

// --- Arrange ---
export const IconAlign = ({ className }: IconProps) => base(<>
  <path d="M4 3.5v13" />
  <rect x="6" y="5" width="8" height="3.5" rx="0.6" />
  <rect x="6" y="11.5" width="5" height="3.5" rx="0.6" />
</>, className);

export const IconGroup = ({ className }: IconProps) => base(<>
  <rect x="3.5" y="3.5" width="8" height="8" rx="1" />
  <rect x="8.5" y="8.5" width="8" height="8" rx="1" />
</>, className);

export const IconCopy = ({ className }: IconProps) => base(<>
  <rect x="7" y="7" width="9" height="10" rx="1" />
  <path d="M5 12V5a1 1 0 0 1 1-1h7" />
</>, className);

export const IconPaste = ({ className }: IconProps) => base(<>
  <rect x="5" y="4" width="10" height="13" rx="1.5" />
  <rect x="7.5" y="2.5" width="5" height="3" rx="1" />
  <path d="M7.5 9.5h5M7.5 12.5h3.5" />
</>, className);

export const IconDelete = ({ className }: IconProps) => base(<>
  <path d="M4.5 6h11" />
  <path d="M8 6V4.5h4V6" />
  <path d="M6 6l0.7 9.5a1 1 0 0 0 1 0.9h4.6a1 1 0 0 0 1-0.9L14 6" />
</>, className);

export const IconUnlock = ({ className }: IconProps) => base(<>
  <rect x="4.5" y="9" width="11" height="7.5" rx="1.2" />
  <path d="M7 9V6.5a3 3 0 0 1 5.7-1.3" />
</>, className);

// --- View ---
export const IconGrid = ({ className }: IconProps) => base(<>
  <path d="M3.5 7.2h13M3.5 12.8h13" />
  <path d="M7.2 3.5v13M12.8 3.5v13" />
</>, className);

export const IconGuides = ({ className }: IconProps) => base(<>
  <path d="M10 3v5M10 12v5M3 10h5M12 10h5" />
  <circle cx="10" cy="10" r="1.4" />
</>, className);

export const IconFitSlide = ({ className }: IconProps) => base(<>
  <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
  <path d="M7 8l-1.6-1.6M6 8V6.4h1.6M13 8l1.6-1.6M14 8V6.4h-1.6M7 12l-1.6 1.6M6 12v1.6h1.6M13 12l1.6 1.6M14 12v1.6h-1.6" />
</>, className);

export const IconFitWidth = ({ className }: IconProps) => base(<>
  <path d="M3.5 10h13" />
  <path d="M6 7l-2.5 3L6 13M14 7l2.5 3L14 13" />
</>, className);

export const IconRatio = ({ className }: IconProps) => base(<rect x="2.5" y="5.5" width="15" height="9" rx="1" />, className);

export const IconBackgroundImage = ({ className }: IconProps) => base(<>
  <rect x="3" y="4" width="14" height="12" rx="1.5" />
  <path d="M3 13l4-3.5 3 2.5 3-3 4 3.5" />
</>, className);

export const IconRestore = ({ className }: IconProps) => base(<>
  <path d="M4 10a6 6 0 1 0 1.8-4.3" />
  <path d="M3 4v3.2h3.2" />
  <path d="M10 7v3l2.2 2.2" />
</>, className);

// --- Global bar / overflow ---
export const IconOpen = ({ className }: IconProps) => base(<path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />, className);

export const IconImportZip = ({ className }: IconProps) => base(<>
  <path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  <path d="M10 8v4.5M10 8L8.2 9.8M10 8l1.8 1.8" />
</>, className);

export const IconPreview = ({ className }: IconProps) => base(<>
  <path d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z" />
  <circle cx="10" cy="10" r="2" />
</>, className);

export const IconExport = ({ className }: IconProps) => base(<>
  <path d="M10 3v9" />
  <path d="M6.5 8.5L10 12l3.5-3.5" />
  <path d="M4 14v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V14" />
</>, className);

export const IconPresenter = ({ className }: IconProps) => base(<>
  <rect x="3" y="4" width="14" height="9.5" rx="1.2" />
  <path d="M7.5 17h5M10 13.5V17" />
</>, className);

export const IconPrint = ({ className }: IconProps) => base(<>
  <path d="M6 7.5V3.5h8v4" />
  <rect x="3.5" y="7.5" width="13" height="6.5" rx="1" />
  <rect x="6" y="11.5" width="8" height="5" rx="0.6" />
</>, className);

export const IconNotes = ({ className }: IconProps) => base(<>
  <rect x="3.5" y="4" width="13" height="10" rx="1.4" />
  <path d="M7 15.5l2-1.5h2l2 1.5" />
  <path d="M6.5 7.5h7M6.5 10h4.5" />
</>, className);

export const IconTable = ({ className }: IconProps) => base(<>
  <rect x="3" y="4.5" width="14" height="11" rx="1" />
  <path d="M3 8.4h14M3 12h14M7.8 8.4v7.1M12.2 8.4v7.1" />
</>, className);

export const IconFormatPainter = ({ className }: IconProps) => base(<>
  <rect x="4" y="3" width="12" height="4.5" rx="1" />
  <path d="M10 7.5v3.5" />
  <rect x="8" y="11" width="4" height="6" rx="1.2" />
</>, className);

export const IconLayers = ({ className }: IconProps) => base(<>
  <path d="M10 3.5l6.5 3.3L10 10.1 3.5 6.8z" />
  <path d="M3.5 10.4L10 13.7l6.5-3.3" />
  <path d="M3.5 13.9L10 17.2l6.5-3.3" />
</>, className);

export const IconStorage = ({ className }: IconProps) => base(<>
  <path d="M6 14.5a3.2 3.2 0 0 1-.6-6.35A4 4 0 0 1 13.4 6.9 3.4 3.4 0 0 1 13 14.5z" />
</>, className);

export const IconMoreTools = ({ className }: IconProps) => base(<>
  <circle cx="10" cy="5.2" r="1.1" />
  <circle cx="10" cy="10" r="1.1" />
  <circle cx="10" cy="14.8" r="1.1" />
</>, className);

export const IconSettings = ({ className }: IconProps) => base(<>
  <circle cx="10" cy="10" r="2.6" />
  <path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.5 5.5l1.4 1.4M13.1 13.1l1.4 1.4M14.5 5.5l-1.4 1.4M6.9 13.1l-1.4 1.4" />
</>, className);
