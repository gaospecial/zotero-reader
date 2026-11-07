import type { HighlightColor, Note, NoteLocator } from '../types';

const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,td,th,figcaption';
const CONTEXT_LENGTH = 40;

export const HIGHLIGHT_COLOR_OPTIONS: { color: HighlightColor; label: string }[] = [
  { color: 'yellow', label: '黄色' },
  { color: 'green', label: '绿色' },
  { color: 'blue', label: '蓝色' },
  { color: 'pink', label: '粉色' },
];

interface CharacterPosition {
  node: Text;
  start: number;
  end: number;
}

interface TextModel {
  text: string;
  characters: CharacterPosition[];
  offsets: Map<Text, number[]>;
}

export function normalizeAnchorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseNoteLocator(value: string | null): NoteLocator | null {
  if (!value) return null;
  try {
    const locator = JSON.parse(value) as Partial<NoteLocator>;
    if (locator.version !== 1 || typeof locator.sectionIndex !== 'number' || typeof locator.sectionTitle !== 'string'
      || typeof locator.exact !== 'string' || !locator.exact || typeof locator.prefix !== 'string' || typeof locator.suffix !== 'string'
      || typeof locator.start !== 'number' || typeof locator.end !== 'number') return null;
    const color = HIGHLIGHT_COLOR_OPTIONS.some(option => option.color === locator.color) ? locator.color! : 'yellow';
    return { ...locator, color } as NoteLocator;
  } catch {
    return null;
  }
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent || parent.closest('.katex-mathml') || !text.data) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function buildTextModel(root: HTMLElement): TextModel {
  const nodes = textNodes(root);
  const characters: CharacterPosition[] = [];
  const offsets = new Map<Text, number[]>();
  let text = '';
  let previousBlock: Element | null = null;

  const append = (value: string, node: Text, start: number, end: number) => {
    if (!value) return;
    text += value;
    for (let index = 0; index < value.length; index += 1) characters.push({ node, start, end });
  };
  const appendSpace = (node: Text, start: number, end: number) => {
    if (text && !text.endsWith(' ')) append(' ', node, start, end);
  };

  nodes.forEach(node => {
    const raw = node.data;
    const nodeOffsets = new Array<number>(raw.length + 1);
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (characters.length && block !== previousBlock) appendSpace(node, 0, 0);

    let index = 0;
    while (index < raw.length) {
      nodeOffsets[index] = text.length;
      if (/\s/.test(raw[index])) {
        const start = index;
        while (index < raw.length && /\s/.test(raw[index])) {
          nodeOffsets[index] = text.length;
          index += 1;
          if (index <= raw.length) nodeOffsets[index] = text.length;
        }
        appendSpace(node, start, index);
        continue;
      }
      const start = index;
      const codePoint = raw.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      index += character.length;
      if (character.length > 1) nodeOffsets[index - 1] = text.length + 1;
      append(character, node, start, index);
      nodeOffsets[index] = text.length;
    }
    if (raw.length === 0) nodeOffsets[0] = text.length;
    offsets.set(node, nodeOffsets);
    previousBlock = block;
  });

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    characters.pop();
  }
  return { text, characters, offsets };
}

function positionOffset(model: TextModel, node: Node, offset: number): number | null {
  if (node instanceof Text) return model.offsets.get(node)?.[offset] ?? null;
  if (!(node instanceof Element)) return null;
  const nodes = [...model.offsets.keys()];
  const child = node.childNodes[offset];
  if (child) {
    const next = nodes.find(candidate => child === candidate || child.contains(candidate));
    if (next) return model.offsets.get(next)?.[0] ?? null;
  }
  const previous = node.childNodes[offset - 1];
  if (previous) {
    const prior = [...nodes].reverse().find(candidate => previous === candidate || previous.contains(candidate));
    if (prior) {
      const values = model.offsets.get(prior)!;
      return values[values.length - 1] ?? null;
    }
  }
  return null;
}

export function createNoteLocator(root: HTMLElement, range: Range, sectionIndex: number, sectionTitle: string, color: HighlightColor = 'yellow'): NoteLocator | null {
  const model = buildTextModel(root);
  let start = positionOffset(model, range.startContainer, range.startOffset);
  let end = positionOffset(model, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) {
    const exact = normalizeAnchorText(range.toString());
    const found = exact ? model.text.indexOf(exact) : -1;
    if (found < 0) return null;
    start = found;
    end = found + exact.length;
  }
  while (start < end && model.text[start] === ' ') start += 1;
  while (end > start && model.text[end - 1] === ' ') end -= 1;
  const exact = model.text.slice(start, end);
  if (!exact || end <= start) return null;
  return {
    version: 1,
    sectionIndex,
    sectionTitle,
    exact,
    prefix: model.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: model.text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
    color,
  };
}

function findAnchor(model: TextModel, locator: NoteLocator): { start: number; end: number } | null {
  const exact = normalizeAnchorText(locator.exact);
  if (!exact) return null;
  if (model.text.slice(locator.start, locator.start + exact.length) === exact) {
    return { start: locator.start, end: locator.start + exact.length };
  }
  const contextual = `${locator.prefix}${exact}${locator.suffix}`;
  const contextualIndex = model.text.indexOf(contextual);
  if (contextualIndex >= 0) {
    const start = contextualIndex + locator.prefix.length;
    return { start, end: start + exact.length };
  }
  const candidates: number[] = [];
  let from = 0;
  while (from <= model.text.length - exact.length) {
    const index = model.text.indexOf(exact, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + 1;
  }
  if (!candidates.length) return null;
  const start = candidates.reduce((best, candidate) => Math.abs(candidate - locator.start) < Math.abs(best - locator.start) ? candidate : best);
  return { start, end: start + exact.length };
}

interface HighlightInterval {
  start: number;
  end: number;
  note: Note;
}

export function applyNoteHighlights(root: HTMLElement, notes: Note[]): Set<string> {
  const matched = new Set<string>();
  if (!notes.length) return matched;
  const model = buildTextModel(root);
  const intervals = new Map<Text, HighlightInterval[]>();

  notes.forEach(note => {
    const locator = parseNoteLocator(note.locator);
    if (!locator) return;
    const anchor = findAnchor(model, locator);
    if (!anchor) return;
    matched.add(note.id);
    for (let index = anchor.start; index < anchor.end; index += 1) {
      const character = model.characters[index];
      if (!character || character.end <= character.start) continue;
      const values = intervals.get(character.node) ?? [];
      const previous = values[values.length - 1];
      if (previous?.note.id === note.id && previous.end >= character.start) previous.end = Math.max(previous.end, character.end);
      else values.push({ note, start: character.start, end: character.end });
      intervals.set(character.node, values);
    }
  });

  intervals.forEach((values, node) => {
    const applied: HighlightInterval[] = [];
    values.sort((a, b) => b.start - a.start || a.end - b.end).forEach(interval => {
      if (applied.some(other => interval.start < other.end && interval.end > other.start)) return;
      const range = document.createRange();
      range.setStart(node, interval.start);
      range.setEnd(node, interval.end);
      const mark = document.createElement('mark');
      const content = interval.note.content.trim();
      mark.className = 'memo-highlight';
      mark.dataset.noteId = interval.note.id;
      mark.dataset.color = parseNoteLocator(interval.note.locator)?.color ?? 'yellow';
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-label', content ? `查看选段备忘：${content.slice(0, 40)}` : '查看选段高亮');
      mark.title = content || '选段高亮';
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      applied.push(interval);
    });
  });
  return matched;
}

export function clearNoteHighlights(root: HTMLElement) {
  root.querySelectorAll('mark.memo-highlight').forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    mark.replaceWith(...Array.from(mark.childNodes));
    parent.normalize();
  });
}
