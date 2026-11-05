import { ArrowUpDown, BookOpen, Check, CheckCheck, ChevronDown, FileWarning, Grid2X2, List, MoreHorizontal, RotateCcw, Rows3, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Paper, PaperDetail } from '../types';
import Reader from './Reader';
import { EmptyState, StateBadge } from './ui';

function PaperRow({ paper, selected, comfortable, trash, onOpen, onTrash, onRestore, onRead }: { paper: Paper; selected: boolean; comfortable: boolean; trash: boolean; onOpen: () => void; onTrash: () => void; onRestore: () => void; onRead: () => void }) {
  const [menu, setMenu] = useState(false);
  return <article id={`paper-${paper.id}`} className={`paper-row ${selected ? 'selected' : ''} ${comfortable ? 'comfortable' : ''} ${paper.readState === 'unread' ? 'unread' : ''}`} onDoubleClick={onOpen}>
    <button className={`read-marker ${paper.readState === 'read' ? 'is-read' : ''}`} onClick={onRead} aria-label={paper.readState === 'read' ? '标为未读' : '标为已读'}>{paper.readState === 'read' ? <Check size={11} /> : null}</button>
    <button className="paper-content" onClick={onOpen}>
      <div className="paper-title-line"><h3>{paper.pdfState === 'unavailable' ? paper.title : paper.titleZh || paper.title}</h3><StateBadge paper={paper} /></div>
      <p>{paper.pdfState === 'unavailable' ? paper.abstractNote || 'Zotero 中未填写摘要。' : paper.aiState === 'succeeded' ? paper.oneSentence : paper.needsPdfChoice ? '此文献包含多个 PDF，请选择主 PDF 后开始解析。' : paper.error || '正在等待自动生成结构化中文解读…'}</p>
      <div className="paper-meta"><span>{paper.creators.slice(0, 2).join('、') || '未知作者'}</span><i />{paper.year && <span>{paper.year}</span>}<i /><span>{paper.publication || paper.itemType}</span></div>
    </button>
    <div className="paper-actions"><button className="icon-button" onClick={() => setMenu(!menu)} aria-label="更多操作"><MoreHorizontal size={18} /></button>{menu && <><button className="menu-scrim" aria-label="关闭菜单" onClick={() => setMenu(false)} /><div className="row-menu">{!trash && <button onClick={() => { onOpen(); setMenu(false); }}><BookOpen size={14} />{paper.pdfState === 'unavailable' ? '查看文献信息' : '打开解读'}</button>}{trash ? <button onClick={onRestore}><RotateCcw size={14} />恢复到资源库</button> : <button className="danger" onClick={onTrash}><Trash2 size={14} />移到回收站</button>}</div></>}</div>
  </article>;
}

interface PaperListProps {
  papers: Paper[];
  selectedId?: string;
  readerDetail: PaperDetail | null;
  onOpen: (paper: Paper) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onRead: (paper: Paper) => void;
  onCloseReader: () => void;
  onMemo: () => void;
  onChanged: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  trash?: boolean;
}

export default function PaperList({ papers, selectedId, readerDetail, onOpen, onTrash, onRestore, onRead, onCloseReader, onMemo, onChanged, notify, trash = false }: PaperListProps) {
  const [comfortable, setComfortable] = useState(false);
  const [sort, setSort] = useState('最近更新');
  const [filter, setFilter] = useState('全部');
  const [scrollTop, setScrollTop] = useState(0);
  const filtered = useMemo(() => papers.filter(paper => filter === '全部' || (filter === '已读' && paper.readState === 'read') || (filter === '未读' && paper.readState === 'unread') || (filter === '处理失败' && (paper.parseState === 'failed' || paper.aiState === 'failed'))).sort((a, b) => sort === '标题排序' ? (a.titleZh || a.title).localeCompare(b.titleZh || b.title, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt)), [papers, filter, sort]);
  const rowHeight = comfortable ? 146 : 112;
  const viewportHeight = 650;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const visible = useMemo(() => filtered.slice(start, start + Math.ceil(viewportHeight / rowHeight) + 8), [filtered, start, rowHeight]);
  const row = (paper: Paper) => <PaperRow paper={paper} selected={paper.id === selectedId} comfortable={comfortable} trash={trash} onOpen={() => onOpen(paper)} onTrash={() => onTrash(paper.id)} onRestore={() => onRestore(paper.id)} onRead={() => onRead(paper)} />;
  const expandedReader = (paper: Paper) => {
    if (!readerDetail || readerDetail.id !== paper.id) return null;
    const index = filtered.findIndex(item => item.id === paper.id);
    return <Reader key={readerDetail.id} detail={readerDetail} onBack={onCloseReader} onTrash={() => onTrash(paper.id)} onMemo={onMemo} onChanged={onChanged} onRead={() => onRead(readerDetail)} onPrevious={index > 0 ? () => onOpen(filtered[index - 1]) : undefined} onNext={index < filtered.length - 1 ? () => onOpen(filtered[index + 1]) : undefined} position={{ current: index + 1, total: filtered.length }} notify={notify} />;
  };
  return <section className={`library-panel ${readerDetail ? 'is-reading' : ''}`}>
    <div className="library-toolbar"><div className="filter-tabs">{['全部', '已读', '未读', '处理失败'].map(name => <button key={name} className={filter === name ? 'active' : ''} onClick={() => { setFilter(name); setScrollTop(0); }}>{name}{name === '全部' && <span>{papers.length}</span>}</button>)}</div><div className="view-tools"><button className="sort-button" onClick={() => setSort(sort === '最近更新' ? '标题排序' : '最近更新')}><ArrowUpDown size={14} />{sort}<ChevronDown size={12} /></button><span className="tool-divider" /><button className={!comfortable ? 'active' : ''} onClick={() => setComfortable(false)} aria-label="紧凑视图" aria-pressed={!comfortable} title="紧凑视图：单行摘要"><Rows3 size={16} /><span>紧凑</span></button><button className={comfortable ? 'active' : ''} onClick={() => setComfortable(true)} aria-label="舒展视图" aria-pressed={comfortable} title="舒展视图：双行摘要"><Grid2X2 size={15} /><span>舒展</span></button></div></div>
    {filtered.length === 0 ? <EmptyState icon={trash ? <Trash2 size={26} /> : <FileWarning size={26} />} title={trash ? '回收站是空的' : '没有找到文献'} description={trash ? '移除的文献会先保存在这里，不会影响 Zotero。' : '尝试更换关键词、筛选条件，或从 Zotero 分类导入文献。'} /> : readerDetail ? <div className="virtual-list inline-reading-list" style={{ height: 'calc(100vh - 240px)', minHeight: 380 }}>
      {filtered.map(paper => <div key={paper.id}>{row(paper)}{expandedReader(paper)}</div>)}
    </div> : <div className="virtual-list" onScroll={event => setScrollTop(event.currentTarget.scrollTop)} style={{ height: 'calc(100vh - 240px)', minHeight: 380 }}>
      <div style={{ height: filtered.length * rowHeight, position: 'relative' }}><div style={{ transform: `translateY(${start * rowHeight}px)` }}>{visible.map(paper => <div key={paper.id} style={{ height: rowHeight }}>{row(paper)}</div>)}</div></div>
    </div>}
    <footer className="library-footer"><span><List size={13} />{filtered.length} 篇文献</span><span><CheckCheck size={13} />本地更改已保存</span></footer>
  </section>;
}
