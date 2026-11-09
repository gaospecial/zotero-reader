import { ArrowUpRight, FileText, Highlighter, NotebookPen, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { parseNoteLocator } from '../lib/textAnchors';
import type { Note, Paper } from '../types';
import { EmptyState } from './ui';

export default function NotesView({ papers, onOpen, notify }: { papers: Paper[]; onOpen: (id: string, noteId?: string) => void; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => { const id = setTimeout(() => api.notes(search).then(setNotes).catch(error => notify(String(error), 'error')), 200); return () => clearTimeout(id); }, [search]);
  return <main className="notes-page">
    <header className="page-heading"><span className="eyebrow">YOUR RESEARCH MEMORY</span><h1>查看备忘</h1><p>所有总笔记、选段备忘与颜色高亮都保存在本机，并进入本地搜索。</p></header>
    <div className="notes-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索备忘内容或引用原文…" /></div>
    {notes.length ? <div className="notes-grid">{notes.map(note => {
      const paper = papers.find(item => item.id === note.itemId);
      const locator = parseNoteLocator(note.locator);
      const hasContent = Boolean(note.content.trim());
      return <article className={`note-card ${locator ? 'note-card-anchored' : ''}`} data-color={locator?.color} key={note.id}>
        <div className="note-card-top">{locator && !hasContent ? <Highlighter size={17} /> : <NotebookPen size={17} />}<span className="note-kind">{locator ? hasContent ? '选段备忘' : '颜色高亮' : '总备忘'}</span><time>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</time></div>
        {locator && <blockquote className="note-card-quote" data-color={locator.color} title={locator.sectionTitle}>{locator.exact}</blockquote>}
        <p className={!hasContent ? 'note-card-empty' : ''}>{hasContent ? note.content : '未填写备忘，仅保留选段高亮。'}</p>
        <button onClick={() => onOpen(note.itemId, locator ? note.id : undefined)}><FileText size={13} /><span>{paper?.titleZh || paper?.title || '所属文献'}</span>{locator && <small>回到原文</small>}<ArrowUpRight size={14} /></button>
      </article>;
    })}</div> : <EmptyState icon={<NotebookPen size={26} />} title={search ? '没有匹配的备忘' : '还没有备忘'} description="打开一篇文献添加总备忘，或选中 AI 解读正文后选择颜色高亮或点击“记备忘”。" />}
  </main>;
}
