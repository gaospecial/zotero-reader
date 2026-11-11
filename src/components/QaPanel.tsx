import { ArrowUp, BookMarked, Bot, CircleStop, Eraser, Image as ImageIcon, Info, LoaderCircle, MessageSquareQuote, Sparkles, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, onQaEvent } from '../lib/api';
import type { PaperDetail, QaEvent, QaMessage } from '../types';

export default function QaPanel({ paper, notify, onSource }: { paper: PaperDetail; notify: (message: string, tone?: 'success' | 'error' | 'info') => void; onSource: (heading: string) => void }) {
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamSources, setStreamSources] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMessages([]); setStreamText(''); setStreaming(false); api.qa(paper.id).then(setMessages).catch(error => notify(String(error), 'error')); }, [paper.id]);
  useEffect(() => { let unlisten: (() => void) | undefined; onQaEvent(event => { if (event.itemId !== paper.id) return; handleEvent(event); }).then(fn => { unlisten = fn; }); return () => unlisten?.(); }, [paper.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamText]);
  const handleEvent = (event: QaEvent) => {
    if (event.kind === 'delta') { setStreaming(true); setStreamText(previous => previous + (event.text ?? '')); }
    if (event.kind === 'source') setStreamSources(event.sources ?? []);
    if (event.kind === 'usage') setUsage(event.usage ?? null);
    if (event.kind === 'error') { setStreaming(false); notify(event.text ?? '问答失败', 'error'); }
    if (event.kind === 'done') { setStreaming(false); setStreamText(''); api.qa(paper.id).then(setMessages); }
  };
  const ask = async (question = input) => {
    if (!question.trim() || streaming) return;
    setInput(''); setStreaming(true); setStreamText(''); setStreamSources([]); setUsage(null);
    try { await api.ask(paper.id, question.trim(), handleEvent); await api.qa(paper.id).then(setMessages); setStreaming(false); setStreamText(''); } catch (error) { setStreaming(false); notify(String(error), 'error'); }
  };
  const clear = async () => { if (!window.confirm('清空当前文献的全部问答？文献、解读和备忘不会受影响。')) return; await api.clearQa(paper.id); setMessages([]); notify('当前问答会话已清空。', 'success'); };
  const suggestions = ['这项研究最重要的结论是什么？', '研究方法有哪些局限？', '请解释图 1 表达的结果'];
  return <aside className="qa-panel"><header className="qa-header"><div><span className="qa-symbol"><MessageSquareQuote size={17} /></span><div><h2>文献问答</h2><p>只依据当前论文</p></div></div><button className="icon-button" onClick={clear} aria-label="清空当前会话" disabled={!messages.length && !streaming}><Eraser size={16} /></button></header>
    <div className="qa-context"><BookMarked size={13} /><span>{paper.titleZh || paper.title}</span></div>
    <div className="qa-messages">{messages.length === 0 && !streaming && <div className="qa-empty"><div className="qa-orbit"><Sparkles size={23} /></div><h3>从这篇论文继续追问</h3><p>回答会标注 Markdown 来源；需要看图时才调用论文图片，不混入其他文献或备忘。</p><div className="suggestions">{suggestions.map(text => <button key={text} onClick={() => ask(text)}>{text}<ArrowUp size={12} /></button>)}</div></div>}
      {messages.map(message => <div className={`qa-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}</div><div className="message-body"><div className="message-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>{message.sources.length > 0 && <div className="message-sources"><span>来源</span>{message.sources.slice(0, 3).map(source => <button key={source} onClick={() => onSource(source)}>{source}</button>)}</div>}{message.visualRefs.length > 0 && <div className="visual-ref"><ImageIcon size={12} />引用 {message.visualRefs.length} 张论文图片</div>}{message.inference && <div className="inference-ref"><Info size={12} />包含模型推断，非原文陈述</div>}{message.usage && <small className="usage-label">{message.usage.total_tokens ?? message.usage.totalTokens ?? '—'} tokens</small>}</div></div>)}
      {streaming && <div className="qa-message assistant"><div className="message-avatar"><Bot size={14} /></div><div className="message-body">{streamText ? <div className="message-text"><ReactMarkdown>{streamText}</ReactMarkdown><span className="stream-caret" /></div> : <div className="waiting-answer"><LoaderCircle size={16} className="spin" />正在检索当前文献…</div>}{streamSources.length > 0 && <div className="message-sources"><span>来源</span>{streamSources.slice(0, 3).map(source => <button key={source} onClick={() => onSource(source)}>{source}</button>)}</div>}</div></div>}
      <div ref={bottomRef} />
    </div>
    <div className="qa-composer"><div className="composer-box"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder="围绕这篇文献提问…" rows={3} disabled={streaming} /><div className="composer-bottom"><span>Enter 发送 · Shift + Enter 换行</span><button onClick={() => ask()} disabled={!input.trim() || streaming} aria-label="发送问题">{streaming ? <CircleStop size={17} /> : <ArrowUp size={17} />}</button></div></div><p><Info size={11} />AI 可能出错，关键结论请核对原文{usage?.total_tokens ? ` · 本次 ${usage.total_tokens} tokens` : ''}</p></div>
  </aside>;
}
