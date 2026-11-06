import { FolderOpen, Import, LoaderCircle } from 'lucide-react';
import type { Collection, ImportPreview } from '../types';

interface Props {
  collection: Collection;
  preview: ImportPreview | null;
  loading: boolean;
  onJoin: () => void;
}

export default function CollectionImportCard({ collection, preview, loading, onJoin }: Props) {
  const total = preview?.total ?? collection.itemCount;
  const withPdf = preview?.withPdf ?? collection.pdfCount;
  return <section className="collection-import-empty" aria-labelledby="collection-import-title">
    <div className="collection-import-card">
      <div className="collection-import-icon"><FolderOpen size={27} strokeWidth={1.5} /></div>
      <span className="eyebrow">ZOTERO COLLECTION</span>
      <h2 id="collection-import-title">{collection.name}</h2>
      <p>本文件夹有 <strong>{total}</strong> 篇文献，含有 <strong>{withPdf}</strong> 篇 PDF 全文，<br />尚未导入 Zotero Reader。</p>
      <div className="collection-import-note">{loading ? <><LoaderCircle size={13} className="spin" />正在核对全部子文件夹与 PDF 附件</> : '导入时包含全部子文件夹；加入后的新文献会自动同步并增量解读。'}</div>
      <button className="primary-button" onClick={onJoin}><Import size={15} />加入 Zotero Reader</button>
    </div>
  </section>;
}
