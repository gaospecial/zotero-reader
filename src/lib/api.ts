import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { demoAnswer, demoBootstrap, demoCollections, demoDetail } from './demo';
import type { Attachment, Bootstrap, CollectionOverview, ImportPreview, ImportResult, LibraryQuery, Note, NoteLocator, Paper, PaperDetail, PdfChoice, QaEvent, QaMessage, ServiceConfiguration } from '../types';
import defaultLiteraturePrompt from '../../prompts/literature_interpretation.txt?raw';

export const isDesktop = '__TAURI_INTERNALS__' in window;
const delay = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
let localLiteraturePrompt = defaultLiteraturePrompt.trimEnd();
const localPapers = structuredClone(demoBootstrap.papers);
const localNotes = new Map<string, string>();
const localAnchoredNotes: Note[] = [];
const localQa = new Map<string, QaMessage[]>();
const localServiceConfig: ServiceConfiguration = { zoteroBaseUrl: 'http://127.0.0.1:23119/api/users/0', deepseekApiKey: '', doc2xApiKey: '' };

async function command<T>(name: string, args?: Record<string, unknown>, demo?: () => T | Promise<T>): Promise<T> {
  if (isDesktop) return invoke<T>(name, args);
  if (!demo) throw new Error('此操作需要在桌面应用中使用');
  return demo();
}

export const api = {
  bootstrap: () => command<Bootstrap>('get_bootstrap', undefined, () => {
    const base = structuredClone(demoBootstrap);
    const papers = structuredClone(localPapers);
    return { ...base, papers, stats: { ...base.stats, unread: papers.filter(paper => paper.localState === 'active' && paper.readState === 'unread').length } };
  }),
  connect: () => command<boolean>('connect_zotero', undefined, async () => { await delay(); return true; }),
  listLibrary: (query: LibraryQuery) => command<Paper[]>('list_library', { query }, () => {
    const search = query.search?.toLowerCase() ?? '';
    const collectionKeys = new Set<string>();
    if (query.collection && query.collection !== 'all') {
      collectionKeys.add(query.collection);
      let changed = true;
      while (changed) {
        changed = false;
        demoCollections.forEach(item => { if (item.parentKey && collectionKeys.has(item.parentKey) && !collectionKeys.has(item.key)) { collectionKeys.add(item.key); changed = true; } });
      }
    }
    return localPapers.filter(p => (query.view === 'trash' ? p.localState === 'trash' : p.localState === 'active')
      && (!search || `${p.title}${p.titleZh}${p.oneSentence}`.toLowerCase().includes(search))
      && (!collectionKeys.size || p.collections.some(key => collectionKeys.has(key)))
      && (!query.status || (query.status === 'unread' ? p.readState === 'unread' : query.status === 'read' ? p.readState === 'read' : p.parseState === 'failed' || p.aiState === 'failed')));
  }),
  detail: (itemId: string) => command<PaperDetail>('get_paper_detail', { itemId }, () => ({ ...demoDetail(localPapers.find(p => p.id === itemId)!), note: localNotes.get(itemId) ?? demoDetail(localPapers.find(p => p.id === itemId)!).note })),
  saveNote: (itemId: string, content: string) => command<void>('save_note', { itemId, content }, () => { localNotes.set(itemId, content); }),
  itemNotes: (itemId: string) => command<Note[]>('list_item_notes', { itemId }, () => structuredClone(localAnchoredNotes.filter(note => note.itemId === itemId))),
  createAnchoredNote: (itemId: string, interpretationId: string, content: string, locator: NoteLocator) => command<string>('create_anchored_note', { itemId, interpretationId, content, locator }, () => {
    const id = crypto.randomUUID();
    localAnchoredNotes.push({ id, itemId, interpretationId, title: '', content: content.trim(), locator: JSON.stringify(locator), updatedAt: new Date().toISOString() });
    return id;
  }),
  updateAnchoredNote: (noteId: string, content: string, locator: NoteLocator) => command<void>('update_anchored_note', { noteId, content, locator }, () => {
    const note = localAnchoredNotes.find(item => item.id === noteId);
    if (!note) throw new Error('选段备忘不存在');
    note.content = content.trim();
    note.locator = JSON.stringify(locator);
    note.updatedAt = new Date().toISOString();
  }),
  deleteAnchoredNote: (noteId: string) => command<void>('delete_anchored_note', { noteId }, () => {
    const index = localAnchoredNotes.findIndex(item => item.id === noteId);
    if (index < 0) throw new Error('选段备忘不存在');
    localAnchoredNotes.splice(index, 1);
  }),
  notes: (search?: string) => command<Note[]>('list_notes', { search }, () => {
    const general = [...localNotes].map(([itemId, content]) => ({ id: `note-${itemId}`, itemId, interpretationId: null, title: '', content, locator: null, updatedAt: new Date().toISOString() }) satisfies Note);
    return [...general, ...structuredClone(localAnchoredNotes)]
      .filter(note => !search || note.content.includes(search) || note.locator?.includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }),
  qa: (itemId: string) => command<QaMessage[]>('list_qa', { itemId }, () => localQa.get(itemId) ?? []),
  clearQa: (itemId: string) => command<void>('clear_qa', { itemId }, () => { localQa.delete(itemId); }),
  ask: async (itemId: string, question: string, onEvent: (event: QaEvent) => void) => {
    if (isDesktop) { await invoke('ask_question', { itemId, question }); return; }
    const messages = localQa.get(itemId) ?? [];
    messages.push({ id: crypto.randomUUID(), itemId, role: 'user', content: question, sources: [], visualRefs: [], inference: false, usage: null, createdAt: new Date().toISOString() });
    localQa.set(itemId, messages);
    onEvent({ itemId, messageId: 'demo', kind: 'source', sources: ['研究方法', '主要发现与结果'] });
    const answer = demoAnswer(question);
    for (let i = 0; i < answer.length; i += 8) { await delay(18); onEvent({ itemId, messageId: 'demo', kind: 'delta', text: answer.slice(i, i + 8) }); }
    messages.push({ id: crypto.randomUUID(), itemId, role: 'assistant', content: answer, sources: ['研究方法', '主要发现与结果'], visualRefs: [], inference: true, usage: { total_tokens: 1260 }, createdAt: new Date().toISOString() });
    onEvent({ itemId, messageId: 'demo', kind: 'inference' });
    onEvent({ itemId, messageId: 'demo', kind: 'usage', usage: { total_tokens: 1260 } });
    onEvent({ itemId, messageId: 'demo', kind: 'done' });
  },
  previewImport: (collectionKeys: string[]) => command<ImportPreview>('preview_import', { collectionKeys }, async () => {
    await delay(500);
    const methodsOnly = collectionKeys.length === 1 && collectionKeys[0] === 'methods';
    const total = methodsOnly ? 2 : 24;
    const withPdf = methodsOnly ? 1 : 21;
    return { collectionKeys, collectionNames: collectionKeys.map(key => demoCollections.find(item => item.key === key)?.name ?? key), total, withPdf, withoutPdf: total - withPdf, multiplePdf: methodsOnly ? 0 : 2, pdfIssues: [] };
  }),
  collectionOverviews: () => command<CollectionOverview[]>('get_collection_overviews', undefined, () => demoCollections.map(collection => ({ key: collection.key, total: collection.itemCount, withPdf: collection.pdfCount }))),
  importCollections: (collectionKeys: string[]) => command<ImportResult>('import_collections', { collectionKeys }, async () => {
    await delay(800);
    collectionKeys.forEach(key => { const item = demoCollections.find(collection => collection.key === key); if (item) item.joined = true; });
    const methodsOnly = collectionKeys.length === 1 && collectionKeys[0] === 'methods';
    return methodsOnly ? { imported: 2, queued: 1, skipped: 0 } : { imported: 24, queued: 21, skipped: 2 };
  }),
  syncCollection: (collectionKey: string) => command<ImportResult>('sync_collection', { collectionKey }, async () => { await delay(800); return { imported: 8, queued: 1, skipped: 0 }; }),
  pdfChoices: () => command<PdfChoice[]>('list_pdf_choices', undefined, () => []),
  choosePdf: (itemId: string, pdfKey: string) => command<void>('choose_main_pdf', { itemId, pdfKey }, () => undefined),
  retry: (itemId: string) => command<void>('retry_item', { itemId }, () => undefined),
  regenerate: (itemId: string) => command<void>('regenerate_item', { itemId }, async () => { await delay(700); }),
  cancel: (itemId: string) => command<void>('cancel_item', { itemId }, () => undefined),
  setRead: (itemId: string, readState: string) => command<void>('set_read_state', { itemId, readState }, () => { const p = localPapers.find(p => p.id === itemId); if (p) p.readState = readState as Paper['readState']; }),
  trash: (itemId: string) => command<void>('trash_item', { itemId }, () => { const p = localPapers.find(p => p.id === itemId); if (p) { p.localState = 'trash'; p.pendingZoteroTrash = true; } }),
  restore: (itemId: string) => command<void>('restore_item', { itemId }, () => { const p = localPapers.find(p => p.id === itemId); if (p) { p.localState = 'active'; p.pendingZoteroTrash = false; } }),
  syncTrash: () => command<number>('sync_trash_to_zotero', undefined, async () => { await delay(); return 0; }),
  sync: () => command<number>('sync_zotero', undefined, async () => { await delay(); return 8; }),
  asset: (itemId: string, versionId: string, path: string) => command<string>('get_asset', { itemId, versionId, path }, () => {
    if (path === 'demo/self-regulated-learning.svg' || path === 'demo/structured-feedback-loop.svg') return `/${path}`;
    throw new Error('演示图片不存在');
  }),
  sourceExcerpt: (itemId: string, versionId: string, heading: string) => command<string>('get_source_excerpt', { itemId, versionId, heading }, () => `# ${heading}\n\n这是演示文库中的来源章节。桌面端只返回当前 Markdown 版本里与被引用标题相关的原文及必要上下文，不加载全文。`),
  exportBackup: (path: string) => command<void>('export_backup', { path }),
  restoreBackup: (path: string) => command<void>('restore_backup', { path }),
  openPdf: (itemKey: string) => command<void>('open_zotero_pdf', { itemKey }, () => undefined),
  openConfig: () => command<string>('open_config_file', undefined, () => '演示模式：桌面端将打开应用数据目录中的 config.json'),
  serviceConfiguration: () => command<ServiceConfiguration>('service_configuration', undefined, () => ({ ...localServiceConfig })),
  literaturePrompt: () => command<string>('get_literature_prompt', undefined, () => localLiteraturePrompt),
  saveLiteraturePrompt: (prompt: string) => command<string>('set_literature_prompt', { prompt }, () => {
    const normalized = prompt.trim();
    if (!normalized) throw new Error('提示词不能为空');
    localLiteraturePrompt = normalized;
    return localLiteraturePrompt;
  }),
  resetLiteraturePrompt: () => command<string>('reset_literature_prompt', undefined, () => {
    localLiteraturePrompt = defaultLiteraturePrompt.trimEnd();
    return localLiteraturePrompt;
  }),
  setApiKey: (service: 'deepseek' | 'doc2x', key: string) => command<void>('set_api_key', { service, key }, () => {
    if (service === 'deepseek') { demoBootstrap.services.deepseekConfigured = true; localServiceConfig.deepseekApiKey = key; }
    else { demoBootstrap.services.doc2xConfigured = true; localServiceConfig.doc2xApiKey = key; }
  }),
};

export async function onQaEvent(handler: (event: QaEvent) => void) {
  if (!isDesktop) return () => undefined;
  return listen<QaEvent>('qa-event', event => handler(event.payload));
}
export async function onProgress(handler: (event: { itemId: string; stage: string; message: string }) => void) {
  if (!isDesktop) return () => undefined;
  return listen('paper-progress', event => handler(event.payload as { itemId: string; stage: string; message: string }));
}
export async function onLibrarySynced(handler: () => void) {
  if (!isDesktop) return () => undefined;
  return listen('library-synced', handler);
}
export type { Attachment };
