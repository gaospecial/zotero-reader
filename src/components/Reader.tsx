import { ArrowLeft, ArrowRight, BookOpenCheck, Check, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileText, Highlighter, Image as ImageIcon, LoaderCircle, MessageCircle, NotebookPen, RefreshCw, Share2, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import { applyNoteHighlights, createNoteLocator, HIGHLIGHT_COLOR_OPTIONS, parseNoteLocator } from '../lib/textAnchors';
import type { HighlightColor, Note, NoteLocator, PaperDetail } from '../types';
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
  const [figureIndex, setFigureIndex] = useState(0);
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const [figureWidth, setFigureWidth] = useState(420);
  const [figureExpanded, setFigureExpanded] = useState(false);
  const [figureFloating, setFigureFloating] = useState(false);
  const [figureFloatPosition, setFigureFloatPosition] = useState({ top: 12, right: 0, visible: true });
  const [regenerating, setRegenerating] = useState(false);
  const [source, setSource] = useState<{ title: string; content: string } | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [anchoredNotes, setAnchoredNotes] = useState<Note[]>([]);
  const [memoComposer, setMemoComposer] = useState<{ note: Note | null; locator: NoteLocator } | null>(null);
  const [selectionMemo, setSelectionMemo] = useState<{ locator: NoteLocator; top: number; left: number } | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const figureFloatingRef = useRef(false);
  const figureFrameRef = useRef<number | null>(null);
  const figureResize = useRef<{ startX: number; startWidth: number } | null>(null);
  const metadataOnly = detail.pdfState === 'unavailable';
  const interpretation = metadataOnly ? null : detail.interpretation;
  const figure = interpretation?.figures[figureIndex];
  const figureUrl = figure ? figureUrls[figure.path] : '';
  const hasFigure = Boolean(figure);
  const title = metadataOnly ? detail.title : interpretation?.titleZh || detail.titleZh || detail.title;
  const readingMinutes = useMemo(() => Math.max(1, Math.ceil((interpretation?.sections.reduce((total, section) => total + section.content.length, 0) ?? 0) / 450)), [interpretation]);

  useEffect(() => {
    setFigureIndex(0);
    setFigureUrls({});
    setFigureExpanded(false);
    setFigureFloating(false);
    figureFloatingRef.current = false;
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
    setFigureExpanded(false);
    setFigureIndex(index => Math.min(index, Math.max(0, interpretation.figures.length - 1)));
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
    if (!article || !(scroller instanceof HTMLElement) || !hasFigure) {
      figureFloatingRef.current = false;
      setFigureFloating(false);
      return;
    }
    if (!active) {
      // 保持前一篇文章的布局高度，仅隐藏非激活文章的配图，避免后续标题跳动。
      setFigureFloatPosition(current => current.visible ? { ...current, visible: false } : current);
      return;
    }
    const update = () => {
      figureFrameRef.current = null;
      const layout = layoutRef.current;
      const header = headerRef.current;
      const figureElement = figureRef.current;
      if (!layout || !header || !figureElement) return;
      if (window.innerWidth <= 950) {
        figureFloatingRef.current = false;
        setFigureFloating(false);
        return;
      }
      const scrollerRect = scroller.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      if (figureFloatingRef.current) {
        if (headerRect.bottom > scrollerRect.top + 72) {
          figureFloatingRef.current = false;
          setFigureFloating(false);
          return;
        }
        const articleRect = article.getBoundingClientRect();
        const layoutRect = layout.getBoundingClientRect();
        const figureRect = figureElement.getBoundingClientRect();
        const paddingRight = Number.parseFloat(window.getComputedStyle(layout).paddingRight) || 0;
        const next = {
          top: Math.min(scrollerRect.top + 12, articleRect.bottom - figureRect.height - 12),
          right: window.innerWidth - layoutRect.right + paddingRight,
          visible: articleRect.bottom > scrollerRect.top && articleRect.top < scrollerRect.bottom,
        };
        setFigureFloatPosition(current => current.top === next.top && current.right === next.right && current.visible === next.visible ? current : next);
      } else if (headerRect.bottom < scrollerRect.top + 20) {
        const articleRect = article.getBoundingClientRect();
        if (articleRect.bottom <= scrollerRect.top || articleRect.top >= scrollerRect.bottom) return;
        const figureRect = figureElement.getBoundingClientRect();
        figureFloatingRef.current = true;
        setFigureFloatPosition({ top: scrollerRect.top + 12, right: window.innerWidth - figureRect.right, visible: true });
        setFigureFloating(true);
      }
    };
    const scheduleUpdate = () => {
      if (figureFrameRef.current === null) figureFrameRef.current = window.requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      scroller.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (figureFrameRef.current !== null) window.cancelAnimationFrame(figureFrameRef.current);
      figureFrameRef.current = null;
    };
  }, [active, detail.id, hasFigure]);

  useEffect(() => {
    if (!figureExpanded) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxCloseRef.current?.focus();
    return () => previousFocus?.focus();
  }, [figureExpanded]);

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if ((target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (memoComposer) return;
        event.preventDefault();
        if (figureExpanded) setFigureExpanded(false);
        else if (qaOpen) setQaOpen(false);
        else onBack();
        return;
      }
      if (figureExpanded || memoComposer) return;
      if (event.key.toLowerCase() === 'j' && onNext) { event.preventDefault(); onNext(); }
      if (event.key.toLowerCase() === 'k' && onPrevious) { event.preventDefault(); onPrevious(); }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); onRead(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, figureExpanded, memoComposer, onBack, onNext, onPrevious, onRead, qaOpen]);

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
    if (!note) {
      onNoteJumpHandled?.();
      return;
    }
    const timer = window.setTimeout(() => {
      const locator = parseNoteLocator(note.locator);
      if (!locator) {
        notify('这条备忘的选段定位无法读取，但备忘内容仍保留。', 'info');
        onNoteJumpHandled?.();
        return;
      }
      const article = articleRef.current;
      const section = article?.querySelector<HTMLElement>(`[data-section-index="${locator.sectionIndex}"]`);
      const content = section?.querySelector<HTMLElement>('.markdown-content');
      let target = article?.querySelector<HTMLElement>(`mark[data-note-id="${note.id}"]`);
      let matchedOldVersion = false;
      if (!target && content) {
        const matched = applyNoteHighlights(content, [note]);
        target = content.querySelector<HTMLElement>(`mark[data-note-id="${note.id}"]`);
        matchedOldVersion = matched.has(note.id) && note.interpretationId !== interpretation?.id;
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('memo-highlight-focus');
        window.setTimeout(() => target.classList.remove('memo-highlight-focus'), 1600);
        if (matchedOldVersion) notify('这条备忘属于旧版解读，已定位到当前解读中的相同文字。', 'info');
      } else if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        notify('未找到完全相同的文字，已定位到原章节；引用与备忘内容仍完整保留。', 'info');
      } else {
        notify('这条备忘所属章节已不存在；引用与备忘内容仍完整保留。', 'info');
      }
      onNoteJumpHandled?.();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [jumpToNoteId, anchoredNotes, detail.id, interpretation?.id, notify, onNoteJumpHandled]);

  const refreshAnchoredNotes = async () => {
    try {
      setAnchoredNotes(await api.itemNotes(detail.id));
      onChanged();
    } catch (error) { notify(String(error), 'error'); }
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

  const boundFigureWidth = (width: number) => {
    const available = articleRef.current?.clientWidth || 1140;
    const maximum = Math.max(280, Math.min(720, available - 420));
    return Math.round(Math.max(280, Math.min(maximum, width)));
  };
  const startFigureResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    figureResize.current = { startX: event.clientX, startWidth: figureWidth };
  };
  const moveFigureResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!figureResize.current) return;
    event.preventDefault();
    setFigureWidth(boundFigureWidth(figureResize.current.startWidth + figureResize.current.startX - event.clientX));
  };
  const endFigureResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    figureResize.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeFigureWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setFigureWidth(boundFigureWidth(280));
    if (event.key === 'End') return setFigureWidth(boundFigureWidth(720));
    setFigureWidth(boundFigureWidth(figureWidth + (event.key === 'ArrowLeft' ? 16 : -16)));
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

      <div ref={layoutRef} className={`article-layout ${figure ? 'has-figure' : ''} ${figureFloating ? 'is-figure-floating' : ''}`} style={{ '--figure-width': `${figureWidth}px` } as CSSProperties}>
        <div className="article-main">
          <header className="article-header" ref={headerRef}>
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

          {figure && <aside ref={figureRef} className="article-figure" aria-label="论文配图" style={{ '--figure-float-top': `${figureFloatPosition.top}px`, '--figure-float-right': `${figureFloatPosition.right}px`, visibility: figureFloating && !figureFloatPosition.visible ? 'hidden' : undefined } as CSSProperties}>
            <div className="figure-resize-handle" role="separator" aria-label="调整论文配图宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={figureWidth} aria-valuetext={`${figureWidth} 像素`} title="拖动左边框调整图片宽度" tabIndex={0} onPointerDown={startFigureResize} onPointerMove={moveFigureResize} onPointerUp={endFigureResize} onPointerCancel={endFigureResize} onKeyDown={resizeFigureWithKeyboard}><span /></div>
            <div className="article-figure-top"><span>{figure.label || 'FIGURE'}</span><span aria-live="polite">{figureIndex + 1} / {interpretation?.figures.length}</span></div>
            <div className="article-figure-stage">{figureUrl ? <button type="button" className="article-figure-image-button" onClick={() => setFigureExpanded(true)} aria-label={`放大论文配图：${figure.caption || figure.label || '当前图片'}`} aria-haspopup="dialog" title="点击放大图片"><img src={figureUrl} alt={figure.caption} /></button> : <div className="figure-placeholder"><ImageIcon size={28} /><span>正在读取论文图片</span></div>}
              {interpretation && interpretation.figures.length > 1 && <><button type="button" className="carousel-prev" disabled={figureIndex === 0} onClick={() => setFigureIndex(index => Math.max(0, index - 1))} aria-label="上一张图片"><ChevronLeft size={18} /></button><button type="button" className="carousel-next" disabled={figureIndex === interpretation.figures.length - 1} onClick={() => setFigureIndex(index => Math.min(interpretation.figures.length - 1, index + 1))} aria-label="下一张图片"><ChevronRight size={18} /></button></>}
            </div>
            <div className="article-figure-caption"><strong>{figure.label}</strong><p>{figure.caption}</p></div>
            {interpretation && interpretation.figures.length > 1 && <div className="figure-dots" aria-label="选择论文图片">{interpretation.figures.map((item, index) => <button type="button" key={`${item.path}-${index}`} className={index === figureIndex ? 'active' : ''} onClick={() => setFigureIndex(index)} aria-label={`查看第 ${index + 1} 张图片`} aria-current={index === figureIndex ? 'true' : undefined} />)}</div>}
          </aside>}

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
    {figureExpanded && figure && figureUrl && createPortal(<div className="figure-lightbox" role="dialog" aria-modal="true" aria-label={`${figure.label || '论文图片'}放大预览`} onClick={() => setFigureExpanded(false)}>
      <button ref={lightboxCloseRef} type="button" className="figure-lightbox-close" onClick={() => setFigureExpanded(false)} aria-label="关闭放大图片" title="关闭放大图片（Esc）"><X size={22} /></button>
      <div className="figure-lightbox-body"><img src={figureUrl} alt={figure.caption} onClick={() => setFigureExpanded(false)} title="再次点击关闭放大" /><div className="figure-lightbox-caption"><strong>{figure.label}</strong><p>{figure.caption}</p></div></div>
      <span className="figure-lightbox-hint">再次点击图片或按 Esc 关闭</span>
    </div>, document.body)}
  </section>;
}
