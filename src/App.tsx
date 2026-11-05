import { BookOpen, Import, LoaderCircle, Recycle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ImportDialog from './components/ImportDialog';
import MemoDialog from './components/MemoDialog';
import NotesView from './components/NotesView';
import PaperList from './components/PaperList';
import SettingsDialog from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import { Toast } from './components/ui';
import { api, onProgress } from './lib/api';
import { demoBootstrap } from './lib/demo';
import type { Collection, LibraryStats, Paper, PaperDetail, ServiceStatus, ViewName } from './types';

export default function App() {
  const [view, setView] = useState<ViewName>('library');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ total: 0, unread: 0, processing: 0, trash: 0, pendingSync: 0 });
  const [services, setServices] = useState<ServiceStatus>(demoBootstrap.services);
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState('all');
  const [sort] = useState('updated');
  const [selected, setSelected] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingCollection, setSyncingCollection] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importKeys, setImportKeys] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const notify = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => setToast({ message, tone }), []);

  const refreshMeta = useCallback(async () => {
    const data = await api.bootstrap(); setCollections(data.collections); setStats(data.stats); setServices(data.services); return data.papers;
  }, []);
  const refreshLibrary = useCallback(async () => {
    const query = { search, collection: collection === 'unread' ? undefined : collection, status: collection === 'unread' ? 'unread' : undefined, view: view === 'trash' ? 'trash' : 'library', sort };
    setPapers(await api.listLibrary(query));
  }, [search, collection, view, sort]);
  const refresh = useCallback(async () => { try { const all = await refreshMeta(); await refreshLibrary(); return all; } catch (error) { notify(String(error), 'error'); return []; } }, [refreshMeta, refreshLibrary, notify]);
  const refreshCurrent = useCallback(async () => {
    await refresh();
    if (selected?.id) {
      try { setSelected(await api.detail(selected.id)); } catch (error) { notify(String(error), 'error'); }
    }
  }, [refresh, selected?.id, notify]);

  useEffect(() => { Promise.all([refreshMeta(), refreshLibrary()]).catch(error => notify(String(error), 'error')).finally(() => setLoading(false)); }, []);
  useEffect(() => { const id = setTimeout(() => refreshLibrary().catch(error => notify(String(error), 'error')), 180); return () => clearTimeout(id); }, [refreshLibrary]);
  useEffect(() => { let dispose: (() => void) | undefined; onProgress(() => { void refreshCurrent(); }).then(fn => { dispose = fn; }); return () => dispose?.(); }, [refreshCurrent]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('.search-box input')?.focus(); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);

  const openPaper = async (paper: Paper | string) => {
    const id = typeof paper === 'string' ? paper : paper.id;
    try { const detail = await api.detail(id); setSelected(detail); setView('reader'); if (detail.readState === 'unread') await api.setRead(id, 'reading'); } catch (error) { notify(String(error), 'error'); }
  };
  const trash = async (id: string) => { if (!window.confirm('将这篇文献移入应用回收站？Zotero 原文献暂时不会改变。')) return; try { await api.trash(id); if (selected?.id === id) { setSelected(null); setView('trash'); } await refresh(); notify('已移入应用回收站，可在回收站中统一同步到 Zotero。', 'success'); } catch (error) { notify(String(error), 'error'); } };
  const restore = async (id: string) => { await api.restore(id); await refresh(); notify('文献已恢复到资源库。', 'success'); };
  const toggleRead = async (paper: Paper) => { const readState = paper.readState === 'read' ? 'unread' : 'read'; await api.setRead(paper.id, readState); if (selected?.id === paper.id) setSelected({ ...selected, readState }); await refresh(); };
  const openImport = (keys: string[] = []) => { setImportKeys(keys); setImportOpen(true); };
  const joinCollection = (key: string) => { setCollection(key); setView('library'); openImport([key]); };
  const syncCollection = async (key: string) => {
    if (syncingCollection) return;
    setSyncingCollection(key);
    try {
      const result = await api.syncCollection(key);
      await refresh();
      const name = collections.find(item => item.key === key)?.name ?? '分类';
      notify(`“${name}”同步完成：检查 ${result.imported} 篇，${result.queued} 篇进入解析${result.skipped ? `，${result.skipped} 篇待选择主 PDF` : ''}。`, 'success');
    } catch (error) { notify(String(error), 'error'); } finally { setSyncingCollection(null); }
  };
  const syncTrash = async () => { if (!window.confirm(`即将把 ${stats.pendingSync} 篇文献移入 Zotero 回收站。此操作需要 Zotero 写授权，是否继续？`)) return; setSyncing(true); try { const count = await api.syncTrash(); await refresh(); notify(`已同步 ${count} 篇到 Zotero 回收站。`, 'success'); } catch (error) { notify(String(error), 'error'); } finally { setSyncing(false); } };
  const title = view === 'trash' ? '应用回收站' : collection === 'unread' ? '未读文献' : collection === 'all' ? '全部文献' : collections.find(c => c.key === collection)?.name ?? '文献资源库';
  const subtitle = view === 'trash' ? '本地回收不会影响 Zotero，除非你显式同步。' : '';

  return <div className="app-shell">
    <Sidebar view={view} onView={setView} collection={collection} onCollection={setCollection} collections={collections} stats={stats} services={services} onImport={() => openImport()} onSync={syncCollection} syncingCollection={syncingCollection} onSettings={() => setSettingsOpen(true)} />
    <div className="workspace"><Topbar search={search} onSearch={setSearch} onSettings={() => setSettingsOpen(true)} demoMode={services.demoMode} />
      {loading ? <div className="app-loading"><div className="brand-mark">Z</div><LoaderCircle className="spin" size={20} /><span>正在打开本地研究文库</span></div> : view === 'notes' ? <NotesView papers={papers} onOpen={openPaper} notify={notify} /> : <main className={`library-page ${view === 'reader' ? 'library-reading' : ''}`}>
        <header className="page-heading library-heading"><div><span className="eyebrow">{view === 'trash' ? 'LOCAL RECYCLE BIN' : 'RESEARCH LIBRARY'}</span><h1>{title}<span className="heading-count">{papers.length}</span></h1>{subtitle && <p>{subtitle}</p>}</div>{view === 'trash' ? <button className="primary-button" disabled={!stats.pendingSync || syncing} onClick={syncTrash}>{syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}同步到 Zotero 回收站{stats.pendingSync > 0 && <span className="button-count">{stats.pendingSync}</span>}</button> : <div className="library-heading-actions">{collections.some(item => item.key === collection && !item.joined) && <button className="secondary-button" onClick={() => joinCollection(collection)}><Import size={15} />加入 Zotero Reader</button>}</div>}</header>
        {stats.processing > 0 && view === 'library' && <div className="processing-banner"><LoaderCircle className="spin" size={15} /><span>{stats.processing} 篇文献正在后台解析或生成解读</span><small>过程保持静默，可随时离开此页面</small></div>}
        <PaperList papers={papers} selectedId={selected?.id} readerDetail={view === 'reader' ? selected : null} onOpen={openPaper} onTrash={trash} onRestore={restore} onRead={toggleRead} onCloseReader={() => { setView('library'); setSelected(null); refresh(); }} onMemo={() => setMemoOpen(true)} onChanged={refreshCurrent} notify={notify} trash={view === 'trash'} />
        {!papers.length && view === 'library' && !search && <div className="first-run-actions"><button className="primary-button" onClick={() => openImport()}><Import size={16} />选择 Zotero 分类</button><button className="secondary-button" onClick={() => setSettingsOpen(true)}><BookOpen size={16} />检查连接</button></div>}
        {view === 'trash' && <div className="trash-explainer"><Recycle size={15} /><span>恢复文献会取消待同步标记；同步成功后，Zotero 条目也会进入其回收站。</span></div>}
      </main>}
    </div>
    {importOpen && <ImportDialog collections={collections} initialKeys={importKeys} onClose={() => { setImportOpen(false); setImportKeys([]); refresh(); }} onImported={refresh} notify={notify} />}
    {settingsOpen && <SettingsDialog services={services} onClose={() => setSettingsOpen(false)} onChanged={refresh} notify={notify} />}
    {memoOpen && selected && <MemoDialog detail={selected} onClose={() => { setMemoOpen(false); api.detail(selected.id).then(setSelected); }} notify={notify} />}
    {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
  </div>;
}
