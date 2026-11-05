import { BookOpen, ChevronDown, ChevronRight, Folder, FolderOpen, Import, Library, LoaderCircle, NotebookPen, Plus, Recycle, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Collection, LibraryStats, ServiceStatus, ViewName } from '../types';

interface Props { view: ViewName; onView: (view: ViewName) => void; collection: string; onCollection: (key: string) => void; collections: Collection[]; stats: LibraryStats; services: ServiceStatus; onImport: () => void; onSync: (key: string) => void; syncingCollection: string | null; onSettings: () => void }
export default function Sidebar({ view, onView, collection, onCollection, collections, stats, services, onImport, onSync, syncingCollection, onSettings }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(collections.map(c => c.key)));
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('resize', close); };
  }, [menu]);
  const roots = collections.filter(c => !c.parentKey);
  const menuCollection = menu ? collections.find(item => item.key === menu.key) : null;
  const renderCollection = (item: Collection, depth = 0): React.ReactNode => {
    const children = collections.filter(c => c.parentKey === item.key);
    const open = expanded.has(item.key);
    const busy = syncingCollection === item.key;
    return <div key={item.key}>
      <div className={`tree-row ${collection === item.key && view === 'library' ? 'active' : ''}`} style={{ paddingLeft: 12 + depth * 16 }} onContextMenu={event => { if (!item.joined) return; event.preventDefault(); setMenu({ key: item.key, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 58) }); }}>
        {children.length ? <button className="tree-toggle" onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })} aria-label={open ? '折叠分类' : '展开分类'}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="tree-spacer" />}
        <button className="tree-main" aria-haspopup={item.joined ? 'menu' : undefined} onClick={() => { onCollection(item.key); onView('library'); }}>{collection === item.key ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{item.name}</span>{busy ? <small className="tree-syncing"><LoaderCircle size={11} className="spin" />同步中</small> : <small>{item.itemCount || ''}</small>}</button>
      </div>
      {open && children.map(child => renderCollection(child, depth + 1))}
    </div>;
  };
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">Z</div><div><strong>Zotero</strong><span>READER</span></div><span className="brand-version">0.1</span></div>
    <button className="import-button" onClick={onImport}><Import size={16} /><span>导入 Zotero 分类</span><Plus size={15} /></button>
    <nav className="primary-nav" aria-label="主导航">
      <button className={view === 'library' && collection === 'all' ? 'active' : ''} onClick={() => { onCollection('all'); onView('library'); }}><Library size={17} /><span>全部文献</span><small>{stats.total}</small></button>
      <button className={view === 'library' && collection === 'unread' ? 'active' : ''} onClick={() => { onCollection('unread'); onView('library'); }}><BookOpen size={17} /><span>未读</span><small>{stats.unread}</small></button>
      <button className={view === 'notes' ? 'active' : ''} onClick={() => onView('notes')}><NotebookPen size={17} /><span>查看备忘</span></button>
      <button className={view === 'trash' ? 'active' : ''} onClick={() => onView('trash')}><Recycle size={17} /><span>回收站</span><small>{stats.trash || ''}</small></button>
    </nav>
    <div className="sidebar-section"><div className="section-label"><span>ZOTERO 分类</span><button aria-label="添加分类" onClick={onImport}><Plus size={13} /></button></div><div className="collection-tree">{roots.map(root => renderCollection(root))}</div></div>
    <div className="sidebar-bottom"><button className="connection-card" onClick={onSettings}><span className={`connection-icon ${services.zoteroConnected ? 'connected' : ''}`}>{services.zoteroConnected ? <Wifi size={15} /> : <WifiOff size={15} />}</span><span><strong>{services.demoMode ? '浏览器演示' : services.zoteroConnected ? 'Zotero 已连接' : 'Zotero 未连接'}</strong><small>{services.demoMode ? '桌面端接入真实文库' : services.zoteroConnected ? '本地文库 · 仅本机访问' : '点击检查连接与配置'}</small></span><ChevronRight size={14} /></button></div>
    {menu && menuCollection && <><div className="menu-scrim" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }} /><div className="collection-context-menu" role="menu" aria-label={`${menuCollection.name}分类操作`} style={{ left: menu.x, top: menu.y }}><button role="menuitem" disabled={syncingCollection !== null} onClick={() => { onSync(menuCollection.key); setMenu(null); }}>{syncingCollection === menuCollection.key ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}与 Zotero 同步</button></div></>}
  </aside>;
}
