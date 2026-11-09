import { ArrowLeft, ArrowRight, BookOpenCheck, Check, CircleAlert, ExternalLink, FileText, Highlighter, Image as ImageIcon, LoaderCircle, MessageCircle, NotebookPen, RefreshCw, Share2, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import { createNoteLocator, HIGHLIGHT_COLOR_OPTIONS, parseNoteLocator } from '../lib/textAnchors';
import type { Figure, HighlightColor, Note, NoteLocator, PaperDetail } from '../types';
import AnchoredMemoDialog from './AnchoredMemoDialog';
import MarkdownWithNotes from './MarkdownWithNotes';
import QaPanel from './QaPanel';
import { Modal } from './ui';
import './Reader.css';

interface ReaderProps {
  detail: PaperDetail;
  active?: boolean;
  fontSize?: number;
  onBack: () => void;
  onTrash: () => void;
  onMemo: () => void;
  onChanged: () => void;
  onRead: () => void;
  starred: boolean;
  onToggleStar: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: { current: number; total: number };
  jumpToNoteId?: string;
  onNoteJumpHandled?: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export default function Reader({ detail, active = true, fontSize = 12, onBack, onTrash, onMemo, onChanged, onRead, starred, onToggleStar, onPrevious, onNext, position, jumpToNoteId, onNoteJumpHandled, notify }: ReaderProps) {
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const [figureWidths, setFigureWidths] = useState<Record<string, number>>({});
  const [expandedFigurePath, setExpandedFigurePath] = useState<string | null>(null);
  const [floatingPreview, setFloatingPreview] = useState<{ path: string; top: number } | null>(null);
  const [dismissedFloatingPath, setDismissedFloatingPath] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [source, setSource] = useState<{ title: string; content: string } | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [anchoredNotes, setAnchoredNotes] = useState<Note[]>([]);
  const [memoComposer, setMemoComposer] = useState<{ note: Note | null; locator: NoteLocator } | null>(null);
  const [selectionMemo, setSelectionMemo] = useState<{ locator: NoteLocator; top: number; left: number } | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const floatingFigureRef = useRef<HTMLElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const metadataOnly = detail.pdfState === 'unavailable';
  const interpretation = metadataOnly ? null : detail.interpretation;
  const expandedFigure = interpretation?.figures.find(item => item.path === expandedFigurePath) ?? null;
  const expandedFigureUrl = expandedFigure ? figureUrls[expandedFigure.path] : '';
  const floatingFigure = interpretation?.figures.find(item => item.path === floatingPreview?.path) ?? null;
  const floatingFigureUrl = floatingFigure ? figureUrls[floatingFigure.path] : '';
  const title = metadataOnly ? detail.title : interpretation?.titleZh || detail.titleZh || detail.title;
  const readingMinutes = useMemo(() => Math.max(1, Math.ceil((interpretation?.sections.reduce((total, section) => total + section.content.length, 0) ?? 0) / 450)), [interpretation]);

  useEffect(() => {
    setFigureUrls({});
    setExpandedFigurePath(null);
    setFloatingPreview(null);
    setDismissedFloatingPath(null);
    setSource(null);
    setQaOpen(false);
    setAnchoredNotes([]);
    setMemoComposer(null);
    setSelectionMemo(null);
  }, [detail.id]);

  useEffect(() => {
    let cancelled = false;
    api.itemNotes(detail.id).then(notes => { if (!cancelled) setAnchoredNotes(notes); }).catch(error => { if (!cancelled) notify(String(error), 'error'); });
    return () => { cancelled = true; };
  }, [detail.id, notify]);

  useEffect(() => {
    if (!interpretation?.markdownVersionId) return;
    let cancelled = false;
    setFigureUrls({});
    setExpandedFigurePath(null);
    interpretation.figures.forEach(figure => {
      api.asset(detail.id, interpretation.markdownVersionId!, figure.path)
        .then(url => { if (!cancelled) setFigureUrls(current => ({ ...current, [figure.path]: url })); })
        .catch(() => undefined);
    });
    return () => { cancelled = true; };
  }, [detail.id, interpretation?.markdownVersionId, interpretation?.figures]);

  useEffect(() => {
    const article = articleRef.current;
    const scroller = article?.closest('.inline-reading-list');
    if (!article || !scroller || !active || !interpretation?.figures.length) {
      setFloatingPreview(null);
      return;
    }
    let frame = 0;
    const update = () => {
      const inlineFigures = Array.from(article.querySelectorAll<HTMLElement>('.article-figure-inline'));
      if (!inlineFigures.length) { setFloatingPreview(null); return; }
      const articleRect = article.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const originalsOutOfView = inlineFigures.every(figure => figure.getBoundingClientRect().bottom < scrollerRect.top + 12);
      if (!originalsOutOfView || articleRect.bottom <= scrollerRect.top || articleRect.top >= scrollerRect.bottom) {
        setFloatingPreview(null);
        if (!originalsOutOfView) setDismissedFloatingPath(null);
        return;
      }
      const path = inlineFigures[inlineFigures.length - 1].dataset.figurePath;
      if (!path || path === dismissedFloatingPath) { setFloatingPreview(null); return; }
      const top = Math.max(12, scrollerRect.top - articleRect.top + 12);
      const height = floatingFigureRef.current?.offsetHeight || 230;
      if (top + height + 12 > articleRect.height) { setFloatingPreview(null); return; }
      setFloatingPreview(current => current?.path === path && Math.abs(current.top - top) < 0.5 ? current : { path, top });
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; update(); });
    };
    update();
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      scroller.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, detail.id, dismissedFloatingPath, interpretation?.figures]);

  useEffect(() => {
    if (!expandedFigurePath) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxCloseRef.current?.focus();
    return () => previousFocus?.focus();
  }, [expandedFigurePath]);

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if ((target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (memoComposer) return;
        event.preventDefault();
        if (expandedFigurePath) setExpandedFigurePath(null);
        else if (qaOpen) setQaOpen(false);
        else onBack();
        return;
      }
      if (expandedFigurePath || memoComposer) return;
      if (event.key.toLowerCase() === 'j' && onNext) { event.preventDefault(); onNext(); }
      if (event.key.toLowerCase() === 'k' && onPrevious) { event.preventDefault(); onPrevious(); }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); onRead(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, expandedFigurePath, memoComposer, onBack, onNext, onPrevious, onRead, qaOpen]);

  useEffect(() => {
    const scroller = articleRef.current?.closest('.inline-reading-list');
    const hide = () => setSelectionMemo(null);
    scroller?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    return () => {
      scroller?.removeEventListener('scroll', hide);
      window.removeEventListener('resize', hide);
    };
  }, [detail.id]);

  useEffect(() => {
    if (!jumpToNoteId || !anchoredNotes.length) return;
    const note = anchoredNotes.find(item => item.id === jumpToNoteId);
    if (!note) return;
    const timer = window.setTimeout(() => {
      const locator = parseNoteLocator(note.locator);
      if (!locator) {
        notify('这条备忘的选段定位无法读取，但备忘内容仍保留。', 'info');
        onNoteJumpHandled?.();
        return;
      }
      const target = articleRef.current?.querySelector<HTMLElement>(`mark[data-note-id="${note.id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('memo-highlight-focus');
        window.setTimeout(() => target.classList.remove('memo-highlight-focus'), 1600);
      } else {
        notify('这条备忘属于旧版解读，或原文已变化；引用与备忘内容仍完整保留。', 'info');
      }
      setMemoComposer({ note, locator });
      onNoteJumpHandled?.();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [jumpToNoteId, anchoredNotes, detail.id]);

  const refreshAnchoredNotes = async () => {
    try { setAnchoredNotes(await api.itemNotes(detail.id)); }
    catch (error) { notify(String(error), 'error'); }
  };

  const saveColorHighlight = async (color: HighlightColor) => {
    if (!selectionMemo || !interpretation || savingHighlight) return;
    setSavingHighlight(true);
    try {
      await api.createAnchoredNote(detail.id, interpretation.id, '', { ...selectionMemo.locator, color });
      await refreshAnchoredNotes();
      setSelectionMemo(null);
      window.getSelection()?.removeAllRanges();
      notify('颜色高亮已保存到本地。', 'success');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setSavingHighlight(false);
    }
  };

  const openAnchoredNote = (note: Note) => {
    const locator = parseNoteLocator(note.locator);
    if (!locator) return notify('这条备忘的选段定位无法读取。', 'error');
    setSelectionMemo(null);
    setMemoComposer({ note, locator });
  };

  const handleTextSelection = () => {
    if (!interpretation || memoComposer) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setSelectionMemo(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const element = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const content = element?.closest<HTMLElement>('.markdown-content');
    const section = content?.closest<HTMLElement>('[data-section-index]');
    if (!content || !section || !articleRef.current?.contains(content)) {
      setSelectionMemo(null);
      return;
    }
    const sectionIndex = Number(section.dataset.sectionIndex);
    const locator = createNoteLocator(content, range, sectionIndex, interpretation.sections[sectionIndex]?.title ?? '');
    if (!locator) {
      setSelectionMemo(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 246, rect.left + rect.width / 2 - 120));
    const top = rect.bottom + 48 < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 48);
    setSelectionMemo({ locator, top, left });
  };

  const figureResize = useRef<{ widthKey: string; pointerId: number; startX: number; startWidth: number; containerWidth: number } | null>(null);
  const updateFigureWidth = (widthKey: string, width: number) => {
    const bounded = Math.max(25, Math.min(100, Math.round(width)));
    setFigureWidths(current => ({ ...current, [widthKey]: bounded }));
  };
  const startFigureResize = (event: ReactPointerEvent<HTMLDivElement>, widthKey: string, width: number) => {
    if (event.button !== 0) return;
    const containerWidth = event.currentTarget.closest('.article-main')?.getBoundingClientRect().width ?? 0;
    if (!containerWidth) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    figureResize.current = { widthKey, pointerId: event.pointerId, startX: event.clientX, startWidth: width, containerWidth };
  };
  const moveFigureResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = figureResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateFigureWidth(resize.widthKey, resize.startWidth + (resize.startX - event.clientX) / resize.containerWidth * 100);
  };
  const endFigureResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (figureResize.current?.pointerId !== event.pointerId) return;
    figureResize.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeFigureWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, widthKey: string, width: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return updateFigureWidth(widthKey, 25);
    if (event.key === 'End') return updateFigureWidth(widthKey, 100);
    updateFigureWidth(widthKey, width + (event.key === 'ArrowLeft' ? 5 : -5));
  };

  const renderFigure = (figure: Figure) => {
    const url = figureUrls[figure.path];
    const widthKey = `${detail.id}:${figure.path}`;
    const width = figureWidths[widthKey] ?? 40;
    return <figure className="article-figure-inline" key={figure.path} data-figure-path={figure.path} style={{ '--figure-width': `${width}%` } as CSSProperties}>
      <div className="article-figure-stage">{url ? <button type="button" className="article-figure-image-button" onClick={() => setExpandedFigurePath(figure.path)} aria-label={`放大论文配图：${figure.caption || figure.label || '当前图片'}`} aria-haspopup="dialog" title="点击放大图片"><img src={url} alt={figure.caption} /></button> : <div className="figure-placeholder"><ImageIcon size={28} /><span>正在读取论文图片</span></div>}</div>
      <figcaption className="article-figure-caption"><strong>{figure.label}</strong><p>{figure.caption}</p></figcaption>
      <div className="article-figure-resize-border" role="separator" aria-label={`调整${figure.label || '论文配图'}宽度`} aria-orientation="vertical" aria-valuemin={25} aria-valuemax={100} aria-valuenow={width} aria-valuetext={`${width}%`} title="拖动左边框调整图片宽度" tabIndex={0} onPointerDown={event => startFigureResize(event, widthKey, width)} onPointerMove={moveFigureResize} onPointerUp={endFigureResize} onPointerCancel={endFigureResize} onKeyDown={event => resizeFigureWithKeyboard(event, widthKey, width)} />
    </figure>;
  };

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

  const share = async () => {
    const url = detail.url || (detail.doi ? `https://doi.org/${detail.doi}` : '');
    const text = metadataOnly ? detail.abstractNote || title : detail.oneSentence || title;
    try {
      if (navigator.share) await navigator.share({ title, text, url: url || undefined });
      else { await navigator.clipboard.writeText(`${title}${url ? `\n${url}` : ''}`); notify('文献信息已复制到剪贴板。', 'success'); }
    } catch (error) { if ((error as Error).name !== 'AbortError') notify(String(error), 'error'); }
  };

  return <section className="reader-inline" aria-label="文章详情阅读页" style={{ '--reader-font-size': `${fontSize}px` } as CSSProperties}>
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

      <div className="article-layout">
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

          {interpretation && interpretation.figures.length > 0 && <div className="article-figures-inline" aria-label="论文配图">{interpretation.figures.map(renderFigure)}</div>}

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
          </section> : interpretation ? <div className="article-sections" onMouseUp={handleTextSelection} onKeyUp={handleTextSelection}>{interpretation.sections.map((section, index) => <section id={`section-${detail.id}-${index}`} key={section.title} className="article-section" data-section-index={index}>
            <div className="article-section-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><button className="source-link" onClick={() => openSource(section.source || section.title)}><Highlighter size={11} />定位 Markdown 来源</button></div>
            <MarkdownWithNotes content={section.content} notes={anchoredNotes.filter(note => note.interpretationId === interpretation.id && parseNoteLocator(note.locator)?.sectionIndex === index)} onOpenNote={openAnchoredNote} />
          </section>)}</div> : <div className="generating-state"><div className="thinking-mark"><BookOpenCheck size={28} /></div><h2>{detail.aiState === 'failed' ? '解读生成失败' : '正在梳理论文脉络'}</h2><p>Doc2X 与 DeepSeek 正在静默处理，完成后这里会显示七段结构化解读。</p>{detail.aiState !== 'failed' && <><LoaderCircle size={22} className="spin" /><button className="secondary-button" onClick={() => api.cancel(detail.id).then(onChanged)}>取消处理</button></>}</div>}

          <footer className="article-action-bar">
            <div>
              <button className={starred ? 'active' : ''} onClick={onToggleStar} aria-pressed={starred}><Star size={15} fill={starred ? 'currentColor' : 'none'} />{starred ? '已加星标' : '添加星标'}</button>
              <button onClick={onRead}><Check size={15} />{detail.readState === 'read' ? '标为未读' : '标为已读'}</button>
              <button onClick={share}><Share2 size={15} />分享</button>
              <button onClick={onMemo}><NotebookPen size={15} />备忘</button>
              {!metadataOnly && <button className={qaOpen ? 'active' : ''} onClick={() => setQaOpen(true)}><MessageCircle size={15} />AI 问答</button>}
            </div>
            <button className="zotero-open" onClick={() => api.openPdf(detail.zoteroKey).catch(error => notify(String(error), 'error'))}>在 Zotero 中打开<ExternalLink size={14} /></button>
          </footer>
          <footer className="article-disclaimer"><FileText size={14} /><span>{metadataOnly ? '信息来自 Zotero 条目，未生成 AI 内容。' : '内容由 AI 依据当前文献生成，请结合原文判断。模型推断会单独标识。'}</span><span className="reader-shortcuts">J / K 切换 · M 已读</span></footer>
        </div>
      </div>

      {floatingPreview && floatingFigure && floatingFigureUrl && <aside ref={floatingFigureRef} className="article-figure-floating" aria-label="悬浮论文配图" style={{ top: floatingPreview.top }}>
        <div className="article-figure-floating-header"><span>{floatingFigure.label || '论文配图'} · 悬浮预览</span><button type="button" onClick={() => { setDismissedFloatingPath(floatingFigure.path); setFloatingPreview(null); }} aria-label="收起悬浮图片" title="收起悬浮图片"><X size={13} /></button></div>
        <button type="button" className="article-figure-floating-image" onClick={() => setExpandedFigurePath(floatingFigure.path)} aria-label={`放大悬浮论文配图：${floatingFigure.caption || floatingFigure.label || '当前图片'}`} aria-haspopup="dialog" title="点击放大图片"><img src={floatingFigureUrl} alt={floatingFigure.caption} /></button>
        <p title={floatingFigure.caption}>{floatingFigure.caption}</p>
      </aside>}
    </article>

    {qaOpen && <><button className="qa-drawer-scrim" aria-label="关闭 AI 问答" onClick={() => setQaOpen(false)} /><aside className="reader-qa-drawer"><button className="qa-drawer-close" onClick={() => setQaOpen(false)} aria-label="关闭问答"><X size={17} /></button><QaPanel paper={detail} notify={notify} onSource={openSource} /></aside></>}
    {selectionMemo && createPortal(<div className="selection-highlight-toolbar" role="toolbar" aria-label="选段高亮与备忘" style={{ top: selectionMemo.top, left: selectionMemo.left }} onMouseDown={event => event.preventDefault()}>
      <Highlighter size={14} aria-hidden="true" />
      {HIGHLIGHT_COLOR_OPTIONS.map(option => <button type="button" key={option.color} className="selection-color-button" data-color={option.color} aria-label={`${option.label}高亮`} title={`${option.label}高亮 · 无需填写备忘`} disabled={savingHighlight} onClick={() => saveColorHighlight(option.color)}><span /></button>)}
      <span className="selection-toolbar-divider" />
      <button className="selection-memo-button" disabled={savingHighlight} onClick={() => {
        setMemoComposer({ note: null, locator: selectionMemo.locator });
        setSelectionMemo(null);
        window.getSelection()?.removeAllRanges();
      }}><NotebookPen size={14} />记备忘</button>
    </div>, document.body)}
    {memoComposer && <AnchoredMemoDialog detail={detail} note={memoComposer.note} locator={memoComposer.locator} onClose={() => setMemoComposer(null)} onChanged={refreshAnchoredNotes} notify={notify} />}
    {source && <Modal title={source.title} eyebrow="MARKDOWN SOURCE · CURRENT VERSION" onClose={() => setSource(null)} wide><div className="source-excerpt"><MarkdownWithNotes content={source.content} notes={[]} onOpenNote={() => undefined} /></div></Modal>}
    {expandedFigure && expandedFigureUrl && createPortal(<div className="figure-lightbox" role="dialog" aria-modal="true" aria-label={`${expandedFigure.label || '论文图片'}放大预览`} onClick={() => setExpandedFigurePath(null)}>
      <button ref={lightboxCloseRef} type="button" className="figure-lightbox-close" onClick={() => setExpandedFigurePath(null)} aria-label="关闭放大图片" title="关闭放大图片（Esc）"><X size={22} /></button>
      <div className="figure-lightbox-body"><img src={expandedFigureUrl} alt={expandedFigure.caption} onClick={() => setExpandedFigurePath(null)} title="再次点击关闭放大" /><div className="figure-lightbox-caption"><strong>{expandedFigure.label}</strong><p>{expandedFigure.caption}</p></div></div>
      <span className="figure-lightbox-hint">再次点击图片或按 Esc 关闭</span>
    </div>, document.body)}
  </section>;
}
