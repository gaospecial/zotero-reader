import { NotebookPen, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { parseNoteLocator } from '../lib/textAnchors';
import type { Note, NoteLocator, PaperDetail } from '../types';
import { Modal } from './ui';

interface AnchoredMemoDialogProps {
  detail: PaperDetail;
  note: Note | null;
  locator: NoteLocator;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export default function AnchoredMemoDialog({ detail, note, locator: initialLocator, onClose, onChanged, notify }: AnchoredMemoDialogProps) {
  const [content, setContent] = useState(note?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const locator = note ? parseNoteLocator(note.locator) ?? initialLocator : initialLocator;

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      if (note) await api.updateAnchoredNote(note.id, content);
      else await api.createAnchoredNote(detail.id, detail.interpretation!.id, content, locator);
      notify(note ? '选段备忘已更新。' : '选段备忘已保存到本地。', 'success');
      onChanged();
      onClose();
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note || !window.confirm('删除这条选段备忘？引用高亮也会一并移除。')) return;
    setDeleting(true);
    try {
      await api.deleteAnchoredNote(note.id);
      notify('选段备忘已删除。', 'success');
      onChanged();
      onClose();
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return <Modal title={note ? '编辑选段备忘' : '添加选段备忘'} eyebrow="TEXT ANCHOR · LOCAL NOTE" onClose={onClose}>
    <div className="memo-paper"><NotebookPen size={15} /><span>{detail.titleZh || detail.title}</span></div>
    <div className="anchored-memo-source"><span>{locator.sectionTitle || `第 ${locator.sectionIndex + 1} 节`}</span><blockquote>{locator.exact}</blockquote></div>
    <textarea className="memo-editor" aria-label="选段备忘内容" value={content} onChange={event => setContent(event.target.value)} placeholder="记录你对这段文字的评价、疑问或研究想法…" rows={8} autoFocus />
    <footer className="modal-footer">
      {note ? <button className="text-button danger anchored-memo-delete" onClick={remove} disabled={deleting || saving}><Trash2 size={14} />删除备忘</button> : <span>{content.length} 字 · 自动进入本地搜索</span>}
      <button className="primary-button" onClick={save} disabled={saving || deleting || !content.trim()}><Save size={15} />{note ? '保存修改' : '保存备忘'}</button>
    </footer>
  </Modal>;
}
