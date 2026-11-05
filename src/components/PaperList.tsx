import { ArrowUpDown, BookOpen, CheckCheck, ChevronDown, FileWarning, Grid2X2, List, Minus, MoreHorizontal, Plus, RotateCcw, Rows3, Star, Trash2 } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Paper, PaperDetail } from '../types';
import { readStoredStar } from '../lib/stars';
import Reader from './Reader';
import { EmptyState, StateBadge } from './ui';

function PaperRow({ paper, selected, compact, trash, starred, onOpen, onTrash, onRestore, onStar }: { paper: Paper; selected: boolean; compact: boolean; trash: boolean; starred: boolean; onOpen: () => void; onTrash: () => void; onRestore: () => void; onStar: () => void }) {
  const [menu, setMenu] = useState(false);
  return <article id={`paper-${paper.id}`} className={`paper-row ${selected ? 'selected' : ''} ${compact ? 'compact' : ''} ${paper.readState === 'unread' ? 'unread' : ''}`}>
    <button className={`star-marker ${starred ? 'is-starred' : ''}`} onClick={onStar} aria-label={starred ? '取消星标' : '添加星标'} aria-pressed={starred} title={starred ? '取消星标' : '添加星标'}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button>
    <button className="paper-content" onClick={onOpen} aria-expanded={selected} title={selected ? '点击关闭解读' : '点击打开解读'}>
      <div className="paper-title-line"><h3>{paper.pdfState === 'unavailable' ? paper.title : paper.titleZh || paper.title}</h3><StateBadge paper={paper} /></div>
      <p>{paper.pdfState === 'unavailable' ? paper.abstractNote || 'Zotero 中未填写摘要。' : paper.aiState === 'succeeded' ? paper.oneSentence : paper.needsPdfChoice ? '此文献包含多个 PDF，请选择主 PDF 后开始解析。' : paper.error || '正在等待自动生成结构化中文解读…'}</p>
      <div className="paper-meta"><span className="paper-citation">{paper.creators[0] || '未知作者'}{', '}<strong className="paper-journal" title={paper.publication || paper.itemType}>{paper.journalAbbreviation || paper.publication || paper.itemType}</strong>{paper.year ? `, ${paper.year}` : ''}</span></div>
    </button>
    <div className="paper-actions"><button className="icon-button" onClick={() => setMenu(!menu)} aria-label="更多操作"><MoreHorizontal size={18} /></button>{menu && <><button className="menu-scrim" aria-label="关闭菜单" onClick={() => setMenu(false)} /><div className="row-menu">{!trash && <button onClick={() => { onOpen(); setMenu(false); }}><BookOpen size={14} />{selected ? '关闭解读' : paper.pdfState === 'unavailable' ? '查看文献信息' : '打开解读'}</button>}{trash ? <button onClick={onRestore}><RotateCcw size={14} />恢复到资源库</button> : <button className="danger" onClick={onTrash}><Trash2 size={14} />移到回收站</button>}</div></>}</div>
  </article>;
}

interface PaperListProps {
  papers: Paper[];
  selectedId?: string;
  readerDetails: Record<string, PaperDetail>;
  expandedIds: string[];
  expandAllMode: boolean;
  starredIds: Record<string, boolean>;
  starredOnly?: boolean;
  onToggleStar: (paper: Paper) => void;
  onOpen: (paper: Paper, additive?: boolean) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onRead: (paper: Paper) => void;
  onCloseReader: (id: string) => void;
  onExpandAll: (papers: Paper[]) => void;
  onCollapseAll: () => void;
  onMemo: (detail: PaperDetail) => void;
  onChanged: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  trash?: boolean;
}

export default function PaperList({ papers, selectedId, readerDetails, expandedIds, expandAllMode, starredIds, starredOnly = false, onToggleStar, onOpen, onTrash, onRestore, onRead, onCloseReader, onExpandAll, onCollapseAll, onMemo, onChanged, notify, trash = false }: PaperListProps) {
  const [sort, setSort] = useState('最近更新');
  const [filter, setFilter] = useState('全部');
  const [scrollTop, setScrollTop] = useState(0);
  const [readerFontSize, setReaderFontSize] = useState(12);
  const filtered = useMemo(() => papers.filter(paper => filter === '全部' || (filter === '已读' && paper.readState === 'read') || (filter === '未读' && paper.readState === 'unread') || (filter === '处理失败' && (paper.parseState === 'failed' || paper.aiState === 'failed'))).sort((a, b) => sort === '标题排序' ? (a.titleZh || a.title).localeCompare(b.titleZh || b.title, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt)), [papers, filter, sort]);
  const hasExpandedReaders = filtered.some(paper => expandedIds.includes(paper.id));
  const comfortable = expandAllMode && hasExpandedReaders;
  const listRef = useRef<HTMLDivElement>(null);
  const expandAnchorRef = useRef<{ id: string; top: number } | null>(null);
  const rowHeight = 44;
  const viewportHeight = 650;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const visible = useMemo(() => filtered.slice(start, start + Math.ceil(viewportHeight / rowHeight) + 8), [filtered, start, rowHeight]);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = scrollTop;
  }, [hasExpandedReaders, comfortable]);
  useLayoutEffect(() => {
    const anchor = expandAnchorRef.current;
    const list = listRef.current;
    if (!anchor || !list || anchor.id !== selectedId) return;
    const target = document.getElementById(`paper-${anchor.id}`);
    if (!target) return;
    list.scrollTop += target.getBoundingClientRect().top - anchor.top;
    expandAnchorRef.current = null;
  }, [selectedId, hasExpandedReaders, comfortable]);
  const isStarred = (paper: Paper) => starredIds[paper.id] ?? readStoredStar(paper.id);
  const openReader = (paper: Paper) => {
    const list = listRef.current;
    const target = document.getElementById(`paper-${paper.id}`);
    if (list && target) {
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const fullyVisible = targetRect.top >= listRect.top && targetRect.bottom <= listRect.bottom;
      expandAnchorRef.current = { id: paper.id, top: fullyVisible ? targetRect.top : listRect.top };
    }
    onOpen(paper, expandAllMode);
  };
  const row = (paper: Paper) => <PaperRow paper={paper} selected={expandedIds.includes(paper.id)} compact={!comfortable} trash={trash} starred={isStarred(paper)} onOpen={() => expandedIds.includes(paper.id) ? onCloseReader(paper.id) : openReader(paper)} onTrash={() => onTrash(paper.id)} onRestore={() => onRestore(paper.id)} onStar={() => onToggleStar(paper)} />;
  const expandedReader = (paper: Paper) => {
    const detail = readerDetails[paper.id];
    if (!detail || !expandedIds.includes(paper.id)) return null;
    const index = filtered.findIndex(item => item.id === paper.id);
    return <Reader key={detail.id} detail={detail} active={paper.id === selectedId} fontSize={readerFontSize} starred={isStarred(paper)} onToggleStar={() => onToggleStar(paper)} onBack={() => onCloseReader(paper.id)} onTrash={() => onTrash(paper.id)} onMemo={() => onMemo(detail)} onChanged={onChanged} onRead={() => onRead(detail)} onPrevious={index > 0 ? () => openReader(filtered[index - 1]) : undefined} onNext={index < filtered.length - 1 ? () => openReader(filtered[index + 1]) : undefined} position={{ current: index + 1, total: filtered.length }} notify={notify} />;
  };
  return <section className={`library-panel ${hasExpandedReaders ? 'is-reading' : ''} ${comfortable ? 'is-comfortable' : ''}`} style={{ '--reader-font-size': `${readerFontSize}px` } as React.CSSProperties}>
    <div className="library-toolbar"><div className="filter-tabs">{['全部', '已读', '未读', '处理失败'].map(name => <button key={name} className={filter === name ? 'active' : ''} onClick={() => { setFilter(name); setScrollTop(0); }}>{name}{name === '全部' && <span>{papers.length}</span>}</button>)}</div><div className="view-tools"><button className="sort-button" onClick={() => setSort(sort === '最近更新' ? '标题排序' : '最近更新')}><ArrowUpDown size={14} />{sort}<ChevronDown size={12} /></button><span className="tool-divider" /><button className={!comfortable ? 'active' : ''} onClick={onCollapseAll} aria-label="紧凑视图" aria-pressed={!comfortable} title="折叠全部阅读区"><Rows3 size={16} /><span>紧凑</span></button><button className={comfortable ? 'active' : ''} onClick={() => onExpandAll(filtered)} aria-label="舒展视图" aria-pressed={comfortable} title="展开当前筛选结果的全部阅读区"><Grid2X2 size={15} /><span>舒展</span></button><span className="tool-divider" /><button onClick={() => setReaderFontSize(size => Math.max(10, size - 1))} disabled={readerFontSize === 10} aria-label="减小阅读字号" title={`减小正文字号（当前 ${readerFontSize}px）`}><Minus size={12} /><span>A</span></button><span className="reader-font-size-value" aria-live="polite">{readerFontSize}px</span><button onClick={() => setReaderFontSize(size => Math.min(22, size + 1))} disabled={readerFontSize === 22} aria-label="增大阅读字号" title={`增大正文字号（当前 ${readerFontSize}px）`}><Plus size={12} /><span>A</span></button></div></div>
    {filtered.length === 0 ? <EmptyState icon={starredOnly ? <Star size={26} /> : trash ? <Trash2 size={26} /> : <FileWarning size={26} />} title={starredOnly ? '还没有星标文献' : trash ? '回收站是空的' : '没有找到文献'} description={starredOnly ? '点击文献左侧的星标，即可把它加入这里。' : trash ? '移除的文献会先保存在这里，不会影响 Zotero。' : '尝试更换关键词、筛选条件，或从 Zotero 分类导入文献。'} /> : hasExpandedReaders ? <div ref={listRef} className={`virtual-list inline-reading-list ${comfortable ? 'is-comfortable' : 'is-compact'}`} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} style={{ height: 'calc(100vh - 240px)', minHeight: 380 }}>
      {filtered.map(paper => <div key={paper.id}>{row(paper)}{expandedReader(paper)}</div>)}
    </div> : <div ref={listRef} className="virtual-list" onScroll={event => setScrollTop(event.currentTarget.scrollTop)} style={{ height: 'calc(100vh - 240px)', minHeight: 380 }}>
      <div style={{ height: filtered.length * rowHeight, position: 'relative' }}><div style={{ transform: `translateY(${start * rowHeight}px)` }}>{visible.map(paper => <div key={paper.id} style={{ height: rowHeight }}>{row(paper)}</div>)}</div></div>
    </div>}
    <footer className="library-footer"><span><List size={13} />{filtered.length} 篇文献</span><span><CheckCheck size={13} />本地更改已保存</span></footer>
  </section>;
}
