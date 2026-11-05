import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Import, LoaderCircle, PackageOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Collection, ImportPreview, ImportResult, PdfChoice } from '../types';
import { Modal } from './ui';

export default function ImportDialog({ collections, initialKeys = [], onClose, onImported, notify }: { collections: Collection[]; initialKeys?: string[]; onClose: () => void; onImported: () => void; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialKeys));
  const [expanded, setExpanded] = useState<Set<string>>(new Set(collections.map(c => c.key)));
  const [step, setStep] = useState<'select' | 'preview' | 'result'>('select');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [choices, setChoices] = useState<PdfChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const roots = useMemo(() => collections.filter(c => !c.parentKey), [collections]);
  const toggle = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const renderCollection = (collection: Collection, depth = 0): React.ReactNode => {
    const children = collections.filter(c => c.parentKey === collection.key);
    const open = expanded.has(collection.key);
    return <div key={collection.key}><div className={`import-tree-row ${selected.has(collection.key) ? 'selected' : ''}`} style={{ paddingLeft: depth * 22 }}><button className="tree-toggle" onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(collection.key)) next.delete(collection.key); else next.add(collection.key); return next; })}>{children.length ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}</button><button className={`check-box ${selected.has(collection.key) ? 'checked' : ''}`} onClick={() => toggle(collection.key)} aria-label={`选择 ${collection.name}`}>{selected.has(collection.key) && <Check size={12} />}</button><button className="import-collection-name" onClick={() => toggle(collection.key)}>{open ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{collection.name}</span><small>{collection.itemCount || ''}</small></button></div>{open && children.map(child => renderCollection(child, depth + 1))}</div>;
  };
  const runPreview = async () => { setBusy(true); try { const value = await api.previewImport([...selected]); setPreview(value); setStep('preview'); } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); } };
  const runImport = async () => { setBusy(true); try { const value = await api.importCollections([...selected]); setResult(value); setChoices(await api.pdfChoices()); setStep('result'); onImported(); } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); } };
  return <Modal title={step === 'select' ? '从 Zotero 导入' : step === 'preview' ? '确认导入范围' : '导入已开始'} eyebrow="LOCAL LIBRARY · NON-DESTRUCTIVE" onClose={onClose} wide>
    <div className="import-steps"><span className="active"><i>1</i>选择分类</span><b /><span className={step !== 'select' ? 'active' : ''}><i>2</i>预览范围</span><b /><span className={step === 'result' ? 'active' : ''}><i>3</i>自动处理</span></div>
    {step === 'select' && <><div className="import-description"><PackageOpen size={18} /><p>选择一个或多个分类。选择父分类时会递归包含全部子分类，已有文献只更新元数据，不会覆盖解读、问答或备忘。</p></div><div className="import-tree">{roots.length ? roots.map(root => renderCollection(root)) : <div className="import-no-collections"><Folder size={24} /><p>尚未读取到分类。请先在 Zotero 中创建分类，或检查本地连接。</p></div>}</div><footer className="modal-footer"><span>已选择 {selected.size} 个分类</span><button className="primary-button" onClick={runPreview} disabled={!selected.size || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}预览导入范围<ArrowRight size={15} /></button></footer></>}
    {step === 'preview' && preview && <>
      <div className="preview-collections">{preview.collectionNames.map(name => <span key={name}><Folder size={13} />{name}</span>)}</div>
      <div className="import-stat-grid"><div><strong>{preview.total}</strong><span>顶层条目</span><small>全部保留在资源库</small></div><div><strong>{preview.withPdf}</strong><span>包含 PDF</span><small>可读附件进入 Doc2X 队列</small></div><div><strong>{preview.withoutPdf}</strong><span>无 PDF</span><small>仅显示 Zotero 元信息</small></div></div>
      {preview.multiplePdf > 0 && <div className="import-notice">其中 {preview.multiplePdf} 篇包含多个 PDF，导入后需要分别选择主 PDF。</div>}
      {preview.pdfIssues.length > 0 ? <div className="import-notice" role="status"><strong>发现 {preview.pdfIssues.length} 个不可读 PDF，将跳过这些附件</strong><p>不会阻塞导入。没有可读 PDF 的条目仅保留 Zotero 元信息，其余文献正常解析和解读；修复附件后重新同步即可恢复处理。</p>{preview.pdfIssues.slice(0, 5).map(issue => <p key={issue.attachmentKey}>《{issue.title}》：{issue.error}</p>)}{preview.pdfIssues.length > 5 && <p>另有 {preview.pdfIssues.length - 5} 个附件未展开。</p>}</div> : <div className="silent-note"><CheckCircle2 size={16} /><div><strong>PDF 路径已确认可读</strong><p>解析与解读将静默运行，你可以继续浏览其他文献。</p></div></div>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setStep('select')}><ArrowLeft size={15} />返回</button><button className="primary-button" onClick={runImport} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Import size={16} />}{preview.pdfIssues.length ? `继续导入 ${preview.total} 篇文献` : `导入 ${preview.total} 篇文献`}</button></footer>
    </>}
    {step === 'result' && result && <><div className="import-success"><CheckCircle2 size={40} /><h3>{result.imported} 篇文献已进入本地资源库</h3><p>{result.queued} 篇开始解析，{result.skipped} 篇等待选择主 PDF。关闭窗口不会中断后台任务。</p></div>{choices.length > 0 && <div className="pdf-choices">{choices.map(choice => <div key={choice.itemId}><strong>请选择主 PDF</strong>{choice.attachments.map(file => <button key={file.key} onClick={() => api.choosePdf(choice.itemId, file.key).then(() => setChoices(previous => previous.filter(c => c !== choice)))}><FileText size={14} />{file.title || file.filename}</button>)}</div>)}</div>}<footer className="modal-footer"><span>任务进度会显示在文献列表中</span><button className="primary-button" onClick={onClose}>查看资源库<ArrowRight size={15} /></button></footer></>}
  </Modal>;
}
