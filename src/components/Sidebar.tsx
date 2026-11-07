import { BookOpen, ChevronDown, ChevronRight, Folder, FolderOpen, Import, Library, LoaderCircle, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Recycle, RefreshCw, Star, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import appIcon from '../../src-tauri/icons/64x64.png';
import type { Collection, LibraryStats, ServiceStatus, ViewName } from '../types';

interface Props { view: ViewName; onView: (view: ViewName) => void; collection: string; onCollection: (key: string) => void; collections: Collection[]; stats: LibraryStats; starredCount: number; services: ServiceStatus; onImport: () => void; onSync: (key: string) => void; syncingCollection: string | null; onSettings: () => void; width: number; collapsed: boolean; onWidthChange: (width: number) => void; onToggleCollapsed: () => void }
export default function Sidebar({ view, onView, collection, onCollection, collections, stats, starredCount, services, onImport, onSync, syncingCollection, onSettings, width, collapsed, onWidthChange, onToggleCollapsed }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(collections.map(c => c.key)));
  const knownCollectionKeys = useRef(new Set(collections.map(c => c.key)));
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const sidebarResize = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    const newKeys = collections.filter(item => !knownCollectionKeys.current.has(item.key)).map(item => item.key);
    knownCollectionKeys.current = new Set(collections.map(item => item.key));
    if (!newKeys.length) return;
    setExpanded(previous => new Set([...previous, ...newKeys]));
  }, [collections]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('resize', close); };
  }, [menu]);
  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sidebarResize.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
  };
  const moveSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    onWidthChange(resize.startWidth + event.clientX - resize.startX);
  };
  const endSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarResize.current?.pointerId !== event.pointerId) return;
    sidebarResize.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return onWidthChange(200);
    if (event.key === 'End') return onWidthChange(360);
    onWidthChange(width + (event.key === 'ArrowRight' ? 10 : -10));
  };
  const roots = collections.filter(c => !c.parentKey);
  const menuCollection = menu ? collections.find(item => item.key === menu.key) : null;
  const renderCollection = (item: Collection, depth = 0): React.ReactNode => {
    const children = collections.filter(c => c.parentKey === item.key);
    const open = expanded.has(item.key);
    const busy = syncingCollection === item.key;
    return <div key={item.key}>
      <div className={`tree-row ${collection === item.key && (view === 'library' || view === 'reader') ? 'active' : ''}`} style={{ paddingLeft: 12 + depth * 16 }} onContextMenu={event => { if (!item.joined) return; event.preventDefault(); setMenu({ key: item.key, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 58) }); }}>
        {children.length ? <button className="tree-toggle" onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })} aria-label={open ? '折叠分类' : '展开分类'}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="tree-spacer" />}
        <button className="tree-main" aria-haspopup={item.joined ? 'menu' : undefined} onClick={() => { onCollection(item.key); onView('library'); }}>{collection === item.key ? <FolderOpen size={15} /> : <Folder size={15} />}<span className="tree-name">{item.name}</span>{busy ? <small className="tree-syncing"><LoaderCircle size={11} className="spin" />同步中</small> : <span className="collection-stats" aria-label={`${item.itemCount} 篇文献，${item.pdfCount} 篇有 PDF 全文，${item.interpretedCount} 篇已解读`}><span data-tooltip="全部文献">{item.itemCount}</span><i>/</i><span data-tooltip="有 PDF 全文">{item.pdfCount}</span><i>/</i><span data-tooltip="已解读">{item.interpretedCount}</span></span>}</button>
      </div>
      {open && children.map(child => renderCollection(child, depth + 1))}
    </div>;
  };
  return <aside className="sidebar">
    <div className="brand"><img className="brand-app-icon" src={appIcon} alt="Zotero Reader 应用图标" /><div><strong>Zotero</strong><span>READER</span></div><span className="brand-version">0.1</span></div>
    <button className="sidebar-toggle" onClick={onToggleCollapsed} aria-label={collapsed ? '展开左侧栏' : '收起左侧栏'} title={collapsed ? '展开左侧栏' : '收起左侧栏'}>{collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}</button>
    {!collapsed && <div className="sidebar-resize-handle" role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={360} aria-valuenow={width} aria-valuetext={`${width} 像素`} title="拖动调整侧栏宽度" tabIndex={0} onPointerDown={startSidebarResize} onPointerMove={moveSidebarResize} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize} onKeyDown={resizeSidebarWithKeyboard} onDoubleClick={() => onWidthChange(224)} />}
    <button className="import-button" onClick={onImport} title="导入 Zotero 分类"><Import size={16} /><span>导入 Zotero 分类</span><Plus size={15} /></button>
    <nav className="primary-nav" aria-label="主导航">
      <button className={(view === 'library' || view === 'reader') && collection === 'all' ? 'active' : ''} onClick={() => { onCollection('all'); onView('library'); }} title="全部文献"><Library size={17} /><span>全部文献</span><small>{stats.total}</small></button>
      <button className={(view === 'library' || view === 'reader') && collection === 'unread' ? 'active' : ''} onClick={() => { onCollection('unread'); onView('library'); }} title="未读"><BookOpen size={17} /><span>未读</span><small>{stats.unread}</small></button>
      <button className={(view === 'library' || view === 'reader') && collection === 'starred' ? 'active' : ''} onClick={() => { onCollection('starred'); onView('library'); }} aria-label="星标" title="星标"><Star size={17} fill={(view === 'library' || view === 'reader') && collection === 'starred' ? 'currentColor' : 'none'} /><span>星标</span><small>{starredCount || ''}</small></button>
      <button className={view === 'notes' ? 'active' : ''} onClick={() => onView('notes')} title="备忘"><NotebookPen size={17} /><span>备忘</span></button>
      <button className={view === 'trash' ? 'active' : ''} onClick={() => onView('trash')} title="回收站"><Recycle size={17} /><span>回收站</span><small>{stats.trash || ''}</small></button>
    </nav>
    <div className="sidebar-section"><div className="section-label"><span>ZOTERO 分类</span></div><div className="collection-tree">{roots.map(root => renderCollection(root))}</div></div>
    <div className="sidebar-bottom"><button className="connection-card" onClick={onSettings} title="连接与设置"><span className={`connection-icon ${services.zoteroConnected ? 'connected' : ''}`}>{services.zoteroConnected ? <Wifi size={15} /> : <WifiOff size={15} />}</span><span><strong>{services.demoMode ? '浏览器演示' : services.zoteroConnected ? 'Zotero 已连接' : 'Zotero 未连接'}</strong><small>{services.demoMode ? '桌面端接入真实文库' : services.zoteroConnected ? '本地文库 · 仅本机访问' : '点击检查连接与配置'}</small></span><ChevronRight size={14} /></button></div>
    {menu && menuCollection && <><div className="menu-scrim" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }} /><div className="collection-context-menu" role="menu" aria-label={`${menuCollection.name}分类操作`} style={{ left: menu.x, top: menu.y }}><button role="menuitem" disabled={syncingCollection !== null} onClick={() => { onSync(menuCollection.key); setMenu(null); }}>{syncingCollection === menuCollection.key ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}与 Zotero 同步</button></div></>}
  </aside>;
}
