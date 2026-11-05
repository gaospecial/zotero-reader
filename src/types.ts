export type ViewName = 'library' | 'reader' | 'notes' | 'trash';
export type PaperState = 'available' | 'missing' | 'unavailable' | 'not_started' | 'queued' | 'processing' | 'retry_wait' | 'succeeded' | 'failed' | 'generating' | 'vision_wait' | 'active' | 'trashed';

export interface Collection { key: string; name: string; parentKey: string | null; itemCount: number; joined: boolean }
export interface Section { title: string; content: string; source?: string }
export interface Figure { path: string; caption: string; label: string }
export interface Interpretation { id: string; itemId: string; markdownVersionId: string | null; titleZh: string; oneSentence: string; sections: Section[]; figures: Figure[]; model: string; createdAt: string }
export interface Paper {
  id: string; zoteroKey: string; zoteroVersion: number; title: string; titleZh: string; oneSentence: string;
  creators: string[]; year: number | null; publication: string; abstractNote: string; doi: string; url: string; itemType: string;
  tags: string[]; collections: string[]; pdfState: string; parseState: string; aiState: string; zoteroState: string; localState: string;
  readState: 'unread' | 'reading' | 'read'; mainPdfKey: string | null; needsPdfChoice: boolean; error: string | null;
  interpretationId: string | null; pendingZoteroTrash: boolean; updatedAt: string; importedAt: string;
}
export interface PaperDetail extends Paper { interpretation: Interpretation | null; note: string }
export interface Note { id: string; itemId: string; interpretationId: string | null; title: string; content: string; locator: string | null; updatedAt: string }
export interface QaMessage { id: string; itemId: string; role: 'user' | 'assistant'; content: string; sources: string[]; visualRefs: string[]; inference: boolean; usage: Record<string, number> | null; createdAt: string }
export interface LibraryQuery { search?: string; collection?: string; status?: string; view?: string; sort?: string }
export interface LibraryStats { total: number; unread: number; processing: number; trash: number; pendingSync: number }
export interface ServiceStatus { zoteroConnected: boolean; deepseekConfigured: boolean; doc2xConfigured: boolean; demoMode: boolean }
export interface Bootstrap { papers: Paper[]; collections: Collection[]; stats: LibraryStats; services: ServiceStatus }
export interface PdfIssue { itemKey: string; title: string; attachmentKey: string; error: string }
export interface ImportPreview { collectionKeys: string[]; collectionNames: string[]; total: number; withPdf: number; withoutPdf: number; multiplePdf: number; pdfIssues: PdfIssue[] }
export interface ImportResult { imported: number; queued: number; skipped: number }
export interface Attachment { key: string; title: string; filename: string }
export interface PdfChoice { itemId: string; attachments: Attachment[] }
export interface QaEvent { itemId: string; messageId: string; kind: 'delta' | 'source' | 'visual' | 'inference' | 'error' | 'usage' | 'done'; text?: string; sources?: string[]; visualRefs?: string[]; usage?: Record<string, number> }
export interface ProgressEvent { itemId: string; stage: string; message: string }
