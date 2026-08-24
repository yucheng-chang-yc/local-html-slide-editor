export type PatchOperation =
  | { type: 'replaceText'; id: string; value: string }
  | { type: 'replaceTextFragment'; id: string; fragmentIndex: number; value: string }
  | { type: 'replaceInnerHtml'; id: string; value: string }
  | { type: 'setStyle'; id: string; value: string }
  | { type: 'setAttribute'; id: string; name: string; value: string }
  | { type: 'deleteElement'; id: string }
  | { type: 'insertElement'; parentId: string; html: string }
  | { type: 'replaceChildren'; id: string; html: string }
  | { type: 'replaceSpeakerNotes'; notes: string[] };

export interface EditableTextFragment {
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface EditableElement {
  id: string;
  tagName: string;
  startOffset: number;
  startTagEndOffset: number;
  endTagStartOffset: number | null;
  endOffset: number;
  attributes: Record<string, string>;
  directText: string;
  directTextFragments: EditableTextFragment[];
  hasElementChildren: boolean;
}

export interface EditableDocument {
  html: string;
  elements: EditableElement[];
  scriptBlocks: string[];
}

export type CompatibilityLevel = 'SUPPORTED' | 'MIXED' | 'READ_ONLY';

export interface RestrictedElement {
  id: string;
  operations: Array<'drag' | 'resize'>;
  reason: string;
}

export interface CompatibilityReport {
  level: CompatibilityLevel;
  reasons: string[];
  documentReadOnly: boolean;
  restrictedElements: RestrictedElement[];
  elementClasses: Array<{ kind: string; status: 'SUPPORTED' | 'LIMITED' | 'UNSUPPORTED' }>;
}
