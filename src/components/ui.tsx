import { useEffect, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}

export function Toast({ message, tone, onClose }: { message: string; tone: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => { const id = window.setTimeout(onClose, 4500); return () => window.clearTimeout(id); }, [message, onClose]);
  return <div className={`toast toast-${tone}`} role="status">{tone === 'success' ? <CheckCircle2 size={18} /> : tone === 'error' ? <CircleAlert size={18} /> : <LoaderCircle size={18} />}<span>{message}</span><button onClick={onClose} aria-label="关闭提示"><X size={15} /></button></div>;
}

export function StateBadge({ paper }: { paper: { pdfState: string; parseState: string; aiState: string; needsPdfChoice: boolean } }) {
  if (paper.pdfState === 'unavailable') return <span className="state-badge">仅元信息</span>;
  if (paper.needsPdfChoice) return <span className="state-badge state-warning">待选 PDF</span>;
  if (paper.parseState === 'failed' || paper.aiState === 'failed') return <span className="state-badge state-error">处理失败</span>;
  if (['queued', 'processing', 'retry_wait'].includes(paper.parseState) || ['queued', 'generating', 'vision_wait'].includes(paper.aiState)) return <span className="state-badge state-working"><span className="pulse-dot" />解读中</span>;
  if (paper.aiState === 'succeeded') return <span className="state-badge state-ready">已解读</span>;
  return <span className="state-badge">待处理</span>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
