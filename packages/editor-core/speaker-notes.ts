export interface SpeakerNotesBlock {
  start: number;
  end: number;
  notes: string[];
}

const INSERTED_NOTES_PATTERN = /\n?<script\s+type=["']application\/json["']\s+data-editor-speaker-notes>(?:.|\r|\n)*?<\/script>\n?/i;

function skipSpaceAndComments(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index += 1; continue; }
    if (source.startsWith('//', index)) {
      index = source.indexOf('\n', index + 2);
      if (index < 0) return source.length;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      return end < 0 ? source.length : skipSpaceAndComments(source, end + 2);
    }
    break;
  }
  return index;
}

function readString(source: string, from: number): { value: string; end: number } | null {
  const quote = source[from];
  if (quote !== '"' && quote !== "'") return null;
  let raw = '';
  let index = from + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === quote) return { value: decodeString(raw), end: index + 1 };
    if (char === '\\' && index + 1 < source.length) {
      raw += char + source[index + 1];
      index += 2;
      continue;
    }
    raw += char;
    index += 1;
  }
  return null;
}

function decodeString(raw: string): string {
  let output = '';
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '\\') { output += raw[index]; continue; }
    const next = raw[++index];
    if (next === undefined) break;
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
    if (next in simple) { output += simple[next]; continue; }
    if (next === 'u') {
      const hex = raw.slice(index + 1, index + 5);
      if (/^[\da-f]{4}$/i.test(hex)) { output += String.fromCharCode(Number.parseInt(hex, 16)); index += 4; continue; }
    }
    if (next === 'x') {
      const hex = raw.slice(index + 1, index + 3);
      if (/^[\da-f]{2}$/i.test(hex)) { output += String.fromCharCode(Number.parseInt(hex, 16)); index += 2; continue; }
    }
    if (next !== '\n' && next !== '\r') output += next;
  }
  return output;
}

export function locateSpeakerNotes(source: string): SpeakerNotesBlock | null {
  const assignment = /\b(?:var|let|const)\s+SPEAKER_NOTES\s*=\s*\[/g.exec(source);
  if (!assignment) return null;
  const start = assignment.index + assignment[0].lastIndexOf('[');
  const notes: string[] = [];
  let index = start + 1;
  while (index < source.length) {
    index = skipSpaceAndComments(source, index);
    if (source[index] === ']') return { start, end: index + 1, notes };
    let value = '';
    let found = false;
    while (index < source.length) {
      index = skipSpaceAndComments(source, index);
      const literal = readString(source, index);
      if (!literal) return null;
      value += literal.value;
      found = true;
      index = skipSpaceAndComments(source, literal.end);
      if (source[index] !== '+') break;
      index += 1;
    }
    if (!found) return null;
    notes.push(value);
    index = skipSpaceAndComments(source, index);
    if (source[index] === ',') { index += 1; continue; }
    if (source[index] === ']') return { start, end: index + 1, notes };
    return null;
  }
  return null;
}

export function extractSpeakerNotes(source: string): string[] | null {
  const inserted = INSERTED_NOTES_PATTERN.exec(source);
  if (inserted) {
    try {
      const parsed = JSON.parse(inserted[0].replace(/^\n?<script[^>]*>|<\/script>\n?$/gi, ''));
      return Array.isArray(parsed) && parsed.every((note) => typeof note === 'string') ? parsed : null;
    } catch {
      return null;
    }
  }
  return locateSpeakerNotes(source)?.notes ?? null;
}

function serializeNotes(notes: string[]): string {
  return JSON.stringify(notes, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function replaceSpeakerNotes(source: string, notes: string[]): string {
  const inserted = INSERTED_NOTES_PATTERN.exec(source);
  const insertedBlock = `\n<script type="application/json" data-editor-speaker-notes>${serializeNotes(notes)}</script>\n`;
  if (inserted) return source.slice(0, inserted.index) + insertedBlock + source.slice(inserted.index + inserted[0].length);

  const block = locateSpeakerNotes(source);
  if (!block && /\b(?:var|let|const)\s+SPEAKER_NOTES\s*=/.test(source)) {
    throw new Error('The existing SPEAKER_NOTES assignment cannot be updated safely.');
  }
  if (!block) {
    const bodyEnd = source.toLowerCase().lastIndexOf('</body>');
    return bodyEnd >= 0 ? source.slice(0, bodyEnd) + insertedBlock + source.slice(bodyEnd) : source + insertedBlock;
  }
  const replacement = `[\n${notes.map((note) => `        ${JSON.stringify(note)}`).join(',\n')}\n    ]`;
  return source.slice(0, block.start) + replacement + source.slice(block.end);
}

export function maskSpeakerNotes(source: string): string {
  if (INSERTED_NOTES_PATTERN.test(source)) return source.replace(INSERTED_NOTES_PATTERN, '');
  const block = locateSpeakerNotes(source);
  return block ? source.slice(0, block.start) + '[/* editor-speaker-notes */]' + source.slice(block.end) : source;
}
