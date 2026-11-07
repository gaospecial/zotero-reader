import { Check, Highlighter, NotebookPen, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { HIGHLIGHT_COLOR_OPTIONS, parseNoteLocator } from '../lib/textAnchors';
import type { HighlightColor, Note, NoteLocator, PaperDetail } from '../types';
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
  const locator = note ? parseNoteLocator(note.locator) ?? initialLocator : initialLocator;
  const [content, setContent] = useState(note?.content ?? '');
  const [color, setColor] = useState<HighlightColor>(locator.color);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const hasContent = Boolean(content.trim());

  const save = async () => {
    setSaving(true);
    try {
      const nextLocator = { ...locator, color };
      if (note) await api.updateAnchoredNote(note.id, content, nextLocator);
      else await api.createAnchoredNote(detail.id, detail.interpretation!.id, content, nextLocator);
      notify(note ? '选段已更新。' : hasContent ? '选段备忘已保存到本地。' : '颜色高亮已保存到本地。', 'success');
      onChanged();
      onClose();
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note || !window.confirm(`删除这条选段${hasContent ? '备忘' : '高亮'}？引用高亮也会一并移除。`)) return;
    setDeleting(true);
    try {
      await api.deleteAnchoredNote(note.id);
      notify(`选段${hasContent ? '备忘' : '高亮'}已删除。`, 'success');
      onChanged();
      onClose();
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return <Modal title={note ? `编辑选段${hasContent ? '备忘' : '高亮'}` : '添加选段备忘'} eyebrow="TEXT ANCHOR · LOCAL NOTE" onClose={onClose}>
    <div className="memo-paper"><NotebookPen size={15} /><span>{detail.titleZh || detail.title}</span></div>
    <div className="anchored-memo-source" data-color={color}><span>{locator.sectionTitle || `第 ${locator.sectionIndex + 1} 节`}</span><blockquote>{locator.exact}</blockquote></div>
    <div className="highlight-color-setting">
      <span><Highlighter size={14} />高亮颜色</span>
      <div role="group" aria-label="高亮颜色">{HIGHLIGHT_COLOR_OPTIONS.map(option => <button type="button" key={option.color} className="highlight-color-option" data-color={option.color} aria-label={`${option.label}高亮`} aria-pressed={color === option.color} title={`${option.label}高亮`} onClick={() => setColor(option.color)}><span />{color === option.color && <Check size={12} />}</button>)}</div>
      <small>可只保存高亮，备忘文字可选。</small>
    </div>
    <textarea className="memo-editor" aria-label="选段备忘内容" value={content} onChange={event => setContent(event.target.value)} placeholder="可选：记录你对这段文字的评价、疑问或研究想法…" rows={8} autoFocus />
    <footer className="modal-footer">
      {note ? <button className="text-button danger anchored-memo-delete" onClick={remove} disabled={deleting || saving}><Trash2 size={14} />删除{hasContent ? '备忘' : '高亮'}</button> : <span>{content.length} 字 · 备忘文字可选</span>}
      <button className="primary-button" onClick={save} disabled={saving || deleting}><Save size={15} />{note ? '保存修改' : hasContent ? '保存备忘' : '保存高亮'}</button>
    </footer>
  </Modal>;
}
