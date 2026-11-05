import { ArrowLeft, ArrowRight, BookOpenCheck, Check, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileText, Highlighter, Image as ImageIcon, LoaderCircle, MessageCircle, NotebookPen, RefreshCw, Share2, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { api } from '../lib/api';
import type { PaperDetail } from '../types';
import QaPanel from './QaPanel';
import { Modal } from './ui';
import './Reader.css';

interface ReaderProps {
  detail: PaperDetail;
  onBack: () => void;
  onTrash: () => void;
  onMemo: () => void;
  onChanged: () => void;
  onRead: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: { current: number; total: number };
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export default function Reader({ detail, onBack, onTrash, onMemo, onChanged, onRead, onPrevious, onNext, position, notify }: ReaderProps) {
  const [figureIndex, setFigureIndex] = useState(0);
  const [figureUrl, setFigureUrl] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [source, setSource] = useState<{ title: string; content: string } | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [starred, setStarred] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const metadataOnly = detail.pdfState === 'unavailable';
  const interpretation = metadataOnly ? null : detail.interpretation;
  const figure = interpretation?.figures[figureIndex];
  const title = metadataOnly ? detail.title : interpretation?.titleZh || detail.titleZh || detail.title;
  const readingMinutes = useMemo(() => Math.max(1, Math.ceil((interpretation?.sections.reduce((total, section) => total + section.content.length, 0) ?? 0) / 450)), [interpretation]);

  useEffect(() => {
    setFigureIndex(0);
    setSource(null);
    setQaOpen(false);
    try { setStarred(window.localStorage.getItem(`reader-starred-${detail.id}`) === 'true'); } catch { setStarred(false); }
    const timer = window.setTimeout(() => document.getElementById(`paper-${detail.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(timer);
  }, [detail.id]);

  useEffect(() => {
    setFigureUrl('');
    if (figure && interpretation?.markdownVersionId) api.asset(detail.id, interpretation.markdownVersionId, figure.path).then(setFigureUrl).catch(() => setFigureUrl(''));
  }, [figure, detail.id, interpretation?.markdownVersionId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if ((target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') { event.preventDefault(); qaOpen ? setQaOpen(false) : onBack(); }
      if (event.key.toLowerCase() === 'j' && onNext) { event.preventDefault(); onNext(); }
      if (event.key.toLowerCase() === 'k' && onPrevious) { event.preventDefault(); onPrevious(); }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); onRead(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack, onNext, onPrevious, onRead, qaOpen]);

  const regenerate = async () => {
    setRegenerating(true);
    try { await api.regenerate(detail.id); notify('已提交重新生成，历史解读与备忘会保留。', 'info'); onChanged(); }
    catch (error) { notify(String(error), 'error'); }
    finally { setRegenerating(false); }
  };

  const openSource = async (heading: string) => {
    if (!interpretation?.markdownVersionId) return notify('当前解读没有可定位的 Markdown 原文。', 'info');
    try { setSource({ title: heading, content: await api.sourceExcerpt(detail.id, interpretation.markdownVersionId, heading) }); }
    catch (error) { notify(String(error), 'error'); }
  };

  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    try { window.localStorage.setItem(`reader-starred-${detail.id}`, String(next)); } catch { /* The visual state still works when storage is unavailable. */ }
    notify(next ? '已添加星标。' : '已取消星标。', 'success');
  };

  const share = async () => {
    const url = detail.url || (detail.doi ? `https://doi.org/${detail.doi}` : '');
    const text = metadataOnly ? detail.abstractNote || title : detail.oneSentence || title;
    try {
      if (navigator.share) await navigator.share({ title, text, url: url || undefined });
      else { await navigator.clipboard.writeText(`${title}${url ? `\n${url}` : ''}`); notify('文献信息已复制到剪贴板。', 'success'); }
    } catch (error) { if ((error as Error).name !== 'AbortError') notify(String(error), 'error'); }
  };

  return <section className="reader-inline" aria-label="文章详情阅读页">
    <article className="article-reader" ref={articleRef}>
      <header className="reader-inline-toolbar">
        <div className="reader-mode-label"><BookOpenCheck size={15} /><strong>{metadataOnly ? '文献信息' : 'AI 解读'}</strong>{position && <span>{position.current} / {position.total}</span>}</div>
        <div className="reader-navigation" aria-label="文章导航">
          <button onClick={onPrevious} disabled={!onPrevious} aria-label="上一篇" title="上一篇（K）"><ArrowLeft size={16} /></button>
          <button onClick={onNext} disabled={!onNext} aria-label="下一篇" title="下一篇（J）"><ArrowRight size={16} /></button>
          <span className="reader-toolbar-divider" />
          {!metadataOnly && <button onClick={regenerate} disabled={regenerating} aria-label="重新解读" title="重新解读">{regenerating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button>}
          <button onClick={onTrash} aria-label="移到回收站" title="移到回收站"><Trash2 size={15} /></button>
          <button onClick={onBack} aria-label="收起文章" title="收起文章（Esc）"><X size={17} /></button>
        </div>
      </header>

      <div className={`article-layout ${figure ? 'has-figure' : ''}`}>
        <div className="article-main">
          <header className="article-header">
            <div className="article-kicker"><span className="article-kicker-dot" /><span>{detail.publication || 'ZOTERO READER'}</span><span className="article-kicker-label">{metadataOnly ? 'ZOTERO METADATA' : <><Sparkles size={11} />AI STRUCTURED READING</>}</span></div>
            <h1>{title}</h1>
            {!metadataOnly && <p className="article-original-title">{detail.title}</p>}
            <div className="article-byline">
              <span>{detail.creators.join(' · ') || '未知作者'}</span><i />
              {detail.year && <><span>{detail.year}</span><i /></>}
              {!metadataOnly && <span>约 {readingMinutes} 分钟</span>}
              {interpretation && <><i /><span>{new Date(interpretation.createdAt).toLocaleDateString('zh-CN')}</span></>}
            </div>
            {!metadataOnly && <p className="article-lede">{interpretation?.oneSentence || detail.oneSentence || '解读尚未生成。'}</p>}
            {detail.tags.length > 0 && <div className="article-tags">{detail.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          </header>

          {!metadataOnly && detail.error && <div className="reader-error"><CircleAlert size={18} /><div><strong>自动处理未完成</strong><p>{detail.error}</p></div><button onClick={() => api.retry(detail.id).then(onChanged)}>重试</button></div>}

          {metadataOnly ? <section className="zotero-metadata" aria-label="Zotero 元信息">
            <div className="metadata-heading"><FileText size={18} /><div><h2>Zotero 元信息</h2><p>该条目缺少可用全文，未调用 AI 解读。</p></div></div>
            <dl>
              <div><dt>条目类型</dt><dd>{detail.itemType || '未填写'}</dd></div>
              <div><dt>出版物</dt><dd>{detail.publication || '未填写'}</dd></div>
              <div><dt>年份</dt><dd>{detail.year || '未填写'}</dd></div>
              <div><dt>DOI</dt><dd>{detail.doi || '未填写'}</dd></div>
              {detail.url && <div className="metadata-url"><dt>链接</dt><dd><a href={detail.url} target="_blank" rel="noreferrer">{detail.url}</a></dd></div>}
            </dl>
            <div className="metadata-abstract"><h3>摘要</h3><p>{detail.abstractNote || 'Zotero 中未填写摘要。'}</p></div>
          </section> : interpretation ? <div className="article-sections">{interpretation.sections.map((section, index) => <section id={`section-${detail.id}-${index}`} key={section.title} className="article-section">
            <div className="article-section-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><button className="source-link" onClick={() => openSource(section.source || section.title)}><Highlighter size={11} />定位 Markdown 来源</button></div>
            <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{section.content}</ReactMarkdown></div>
          </section>)}</div> : <div className="generating-state"><div className="thinking-mark"><BookOpenCheck size={28} /></div><h2>{detail.aiState === 'failed' ? '解读生成失败' : '正在梳理论文脉络'}</h2><p>Doc2X 与 DeepSeek 正在静默处理，完成后这里会显示七段结构化解读。</p>{detail.aiState !== 'failed' && <><LoaderCircle size={22} className="spin" /><button className="secondary-button" onClick={() => api.cancel(detail.id).then(onChanged)}>取消处理</button></>}</div>}

          <footer className="article-action-bar">
            <div>
              <button className={starred ? 'active' : ''} onClick={toggleStar} aria-pressed={starred}><Star size={15} fill={starred ? 'currentColor' : 'none'} />{starred ? '已加星标' : '添加星标'}</button>
              <button onClick={onRead}><Check size={15} />{detail.readState === 'read' ? '标为未读' : '标为已读'}</button>
              <button onClick={share}><Share2 size={15} />分享</button>
              <button onClick={onMemo}><NotebookPen size={15} />备忘</button>
              {!metadataOnly && <button className={qaOpen ? 'active' : ''} onClick={() => setQaOpen(true)}><MessageCircle size={15} />AI 问答</button>}
            </div>
            <button className="zotero-open" onClick={() => api.openPdf(detail.zoteroKey).catch(error => notify(String(error), 'error'))}>在 Zotero 中打开<ExternalLink size={14} /></button>
          </footer>
          <footer className="article-disclaimer"><FileText size={14} /><span>{metadataOnly ? '信息来自 Zotero 条目，未生成 AI 内容。' : '内容由 AI 依据当前文献生成，请结合原文判断。模型推断会单独标识。'}</span><span className="reader-shortcuts">J / K 切换 · M 已读</span></footer>
        </div>

        {figure && <aside className="article-figure" aria-label="论文配图">
          <div className="article-figure-top"><span>{figure.label || 'FIGURE'}</span><span>{figureIndex + 1} / {interpretation?.figures.length}</span></div>
          <div className="article-figure-stage">{figureUrl ? <img src={figureUrl} alt={figure.caption} /> : <div className="figure-placeholder"><ImageIcon size={28} /><span>正在读取论文图片</span></div>}
            {interpretation && interpretation.figures.length > 1 && <><button className="carousel-prev" disabled={figureIndex === 0} onClick={() => setFigureIndex(index => index - 1)} aria-label="上一张图片"><ChevronLeft size={18} /></button><button className="carousel-next" disabled={figureIndex === interpretation.figures.length - 1} onClick={() => setFigureIndex(index => index + 1)} aria-label="下一张图片"><ChevronRight size={18} /></button></>}
          </div>
          <div className="article-figure-caption"><strong>{figure.label}</strong><p>{figure.caption}</p></div>
          {interpretation && interpretation.figures.length > 1 && <div className="figure-dots">{interpretation.figures.map((item, index) => <button key={`${item.path}-${index}`} className={index === figureIndex ? 'active' : ''} onClick={() => setFigureIndex(index)} aria-label={`查看第 ${index + 1} 张图片`} />)}</div>}
        </aside>}
      </div>
    </article>

    {qaOpen && <><button className="qa-drawer-scrim" aria-label="关闭 AI 问答" onClick={() => setQaOpen(false)} /><aside className="reader-qa-drawer"><button className="qa-drawer-close" onClick={() => setQaOpen(false)} aria-label="关闭问答"><X size={17} /></button><QaPanel paper={detail} notify={notify} onSource={openSource} /></aside></>}
    {source && <Modal title={source.title} eyebrow="MARKDOWN SOURCE · CURRENT VERSION" onClose={() => setSource(null)} wide><div className="source-excerpt markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{source.content}</ReactMarkdown></div></Modal>}
  </section>;
}
