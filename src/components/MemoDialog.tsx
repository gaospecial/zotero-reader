import { NotebookPen, Save } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { PaperDetail } from '../types';
import { Modal } from './ui';

export default function MemoDialog({ detail, onClose, notify }: { detail: PaperDetail; onClose: () => void; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [content, setContent] = useState(detail.note);
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await api.saveNote(detail.id, content); notify(content.trim() ? '备忘已保存到本地。' : '备忘已删除。', 'success'); onClose(); } catch (error) { notify(String(error), 'error'); } finally { setSaving(false); } };
  return <Modal title="文献备忘" eyebrow="ONE NOTE PER PAPER" onClose={onClose}><div className="memo-paper"><NotebookPen size={15} /><span>{detail.titleZh || detail.title}</span></div><p className="memo-help">每篇文献只有一份总笔记。重新生成解读不会复制或覆盖你的判断。</p><textarea className="memo-editor" value={content} onChange={e => setContent(e.target.value)} placeholder="记录你的评价、疑问、可复用的方法或下一步研究想法…" rows={10} autoFocus /><footer className="modal-footer"><span>{content.length} 字 · 自动进入本地搜索</span><button className="primary-button" onClick={save} disabled={saving}><Save size={15} />保存备忘</button></footer></Modal>;
}
