import { ArrowUpRight, FileText, NotebookPen, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Note, Paper } from '../types';
import { EmptyState } from './ui';

export default function NotesView({ papers, onOpen, notify }: { papers: Paper[]; onOpen: (id: string) => void; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => { const id = setTimeout(() => api.notes(search).then(setNotes).catch(error => notify(String(error), 'error')), 200); return () => clearTimeout(id); }, [search]);
  return <main className="notes-page"><header className="page-heading"><span className="eyebrow">YOUR RESEARCH MEMORY</span><h1>查看备忘</h1><p>所有总笔记与定位笔记都保存在本机，并进入资源库搜索。</p></header><div className="notes-search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索备忘内容…" /></div>{notes.length ? <div className="notes-grid">{notes.map(note => { const paper = papers.find(p => p.id === note.itemId); return <article className="note-card" key={note.id}><div className="note-card-top"><NotebookPen size={17} /><time>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</time></div><p>{note.content}</p><button onClick={() => onOpen(note.itemId)}><FileText size={13} /><span>{paper?.titleZh || paper?.title || '所属文献'}</span><ArrowUpRight size={14} /></button></article>; })}</div> : <EmptyState icon={<NotebookPen size={26} />} title={search ? '没有匹配的备忘' : '还没有备忘'} description="打开一篇文献，点击右上角“备忘”记录你的判断、疑问和后续研究方向。" />}</main>;
}
