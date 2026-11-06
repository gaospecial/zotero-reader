import { useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Note } from '../types';
import { applyNoteHighlights, clearNoteHighlights } from '../lib/textAnchors';

export default function MarkdownWithNotes({ content, notes, onOpenNote }: { content: string; notes: Note[]; onOpenNote: (note: Note) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const noteKey = notes.map(note => `${note.id}:${note.updatedAt}`).join('|') || 'plain';

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !notes.length) return;
    applyNoteHighlights(container, notes);
    return () => clearNoteHighlights(container);
  }, [content, noteKey]);

  const openFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const mark = target.closest('mark.memo-highlight');
    const note = notes.find(item => item.id === mark?.getAttribute('data-note-id'));
    if (note) onOpenNote(note);
  };

  return <div ref={containerRef} className="markdown-content" onClick={event => {
    if (window.getSelection()?.isCollapsed === false) return;
    openFromTarget(event.target);
  }} onKeyDown={event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFromTarget(event.target);
  }}>
    <ReactMarkdown key={noteKey} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
  </div>;
}
