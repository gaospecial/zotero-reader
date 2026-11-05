use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub key: String,
    pub name: String,
    pub parent_key: Option<String>,
    #[serde(default)]
    pub item_count: i64,
    #[serde(default)]
    pub joined: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Figure {
    pub path: String,
    pub caption: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interpretation {
    pub id: String,
    pub item_id: String,
    pub markdown_version_id: Option<String>,
    pub title_zh: String,
    pub one_sentence: String,
    pub sections: Vec<Section>,
    pub figures: Vec<Figure>,
    pub model: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub zotero_key: String,
    pub zotero_version: i64,
    pub title: String,
    pub title_zh: String,
    pub one_sentence: String,
    pub creators: Vec<String>,
    pub year: Option<i32>,
    pub publication: String,
    pub abstract_note: String,
    pub doi: String,
    pub url: String,
    pub item_type: String,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
    pub pdf_state: String,
    pub parse_state: String,
    pub ai_state: String,
    pub zotero_state: String,
    pub local_state: String,
    pub read_state: String,
    pub main_pdf_key: Option<String>,
    pub needs_pdf_choice: bool,
    pub error: Option<String>,
    pub interpretation_id: Option<String>,
    pub pending_zotero_trash: bool,
    pub updated_at: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperDetail {
    #[serde(flatten)]
    pub paper: Paper,
    pub interpretation: Option<Interpretation>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub item_id: String,
    pub interpretation_id: Option<String>,
    pub title: String,
    pub content: String,
    pub locator: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaMessage {
    pub id: String,
    pub item_id: String,
    pub role: String,
    pub content: String,
    pub sources: Vec<String>,
    pub visual_refs: Vec<String>,
    pub inference: bool,
    pub usage: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryQuery {
    pub search: Option<String>,
    pub collection: Option<String>,
    pub status: Option<String>,
    pub view: Option<String>,
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: i64,
    pub unread: i64,
    pub processing: i64,
    pub trash: i64,
    pub pending_sync: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub zotero_connected: bool,
    pub deepseek_configured: bool,
    pub doc2x_configured: bool,
    pub demo_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub papers: Vec<Paper>,
    pub collections: Vec<Collection>,
    pub stats: LibraryStats,
    pub services: ServiceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub collection_keys: Vec<String>,
    pub collection_names: Vec<String>,
    pub total: usize,
    pub with_pdf: usize,
    pub without_pdf: usize,
    pub multiple_pdf: usize,
    pub pdf_issues: Vec<PdfIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfIssue {
    pub item_key: String,
    pub title: String,
    pub attachment_key: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub queued: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfChoice {
    pub item_id: String,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub key: String,
    pub title: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub item_id: String,
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaEvent {
    pub item_id: String,
    pub message_id: String,
    pub kind: String,
    pub text: Option<String>,
    pub sources: Option<Vec<String>>,
    pub visual_refs: Option<Vec<String>>,
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub database: String,
    pub files_dir: String,
}
