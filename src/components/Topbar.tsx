import { CloudCog, PanelLeftClose, Search, Settings2, X } from 'lucide-react';

export default function Topbar({ search, onSearch, onSettings, demoMode, compact }: { search: string; onSearch: (value: string) => void; onSettings: () => void; demoMode: boolean; compact?: boolean }) {
  return <header className={`topbar ${compact ? 'topbar-compact' : ''}`}>
    <div className="search-box"><Search size={17} /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="搜索标题、结论或备忘…" aria-label="搜索本地资源库" />{search ? <button onClick={() => onSearch('')} aria-label="清除搜索"><X size={14} /></button> : <kbd>⌘ K</kbd>}</div>
    <div className="top-actions">{demoMode && <span className="demo-label">DEMO LIBRARY</span>}<button className="icon-button" onClick={onSettings} aria-label="设置"><Settings2 size={19} /></button></div>
    <span className="topbar-decoration"><CloudCog size={0} /><PanelLeftClose size={0} /></span>
  </header>;
}
