use crate::models::*;
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub type SharedDb = Arc<Mutex<Connection>>;

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, zotero_key TEXT NOT NULL UNIQUE, zotero_version INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL, title_zh TEXT NOT NULL DEFAULT '', one_sentence TEXT NOT NULL DEFAULT '',
 creators_json TEXT NOT NULL DEFAULT '[]', year INTEGER, publication TEXT NOT NULL DEFAULT '',
 journal_abbreviation TEXT NOT NULL DEFAULT '', abstract_note TEXT NOT NULL DEFAULT '', doi TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
 item_type TEXT NOT NULL DEFAULT 'journalArticle', tags_json TEXT NOT NULL DEFAULT '[]',
 pdf_state TEXT NOT NULL DEFAULT 'unavailable', parse_state TEXT NOT NULL DEFAULT 'not_started',
 ai_state TEXT NOT NULL DEFAULT 'not_started', zotero_state TEXT NOT NULL DEFAULT 'active',
 local_state TEXT NOT NULL DEFAULT 'active', read_state TEXT NOT NULL DEFAULT 'unread',
 main_pdf_key TEXT, needs_pdf_choice INTEGER NOT NULL DEFAULT 0, error TEXT,
 interpretation_id TEXT, pending_zotero_trash INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL, imported_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS collections (
 key TEXT PRIMARY KEY, name TEXT NOT NULL, parent_key TEXT, version INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
 joined INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item_collections (
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 collection_key TEXT NOT NULL, PRIMARY KEY(item_id, collection_key)
);
CREATE TABLE IF NOT EXISTS attachments (
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 zotero_key TEXT NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL,
 content_type TEXT NOT NULL, PRIMARY KEY(item_id, zotero_key)
);
CREATE TABLE IF NOT EXISTS markdown_versions (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 path TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interpretations (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 markdown_version_id TEXT, title_zh TEXT NOT NULL, one_sentence TEXT NOT NULL,
 sections_json TEXT NOT NULL, figures_json TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 interpretation_id TEXT, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
 locator TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS qa_messages (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]',
 visual_json TEXT NOT NULL DEFAULT '[]', inference INTEGER NOT NULL DEFAULT 0,
 usage_json TEXT, created_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_items_local_state ON items(local_state);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_item ON notes(item_id, deleted);
CREATE INDEX IF NOT EXISTS idx_qa_item ON qa_messages(item_id, deleted, created_at);
"#;

pub fn open(path: &Path) -> Result<SharedDb> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    let conn = Connection::open(path).with_context(|| format!("无法打开数据库 {}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(SCHEMA)?;
    let has_joined=conn.query_row("SELECT COUNT(*) FROM pragma_table_info('collections') WHERE name='joined'",[],|row|row.get::<_,i64>(0))?;
    if has_joined==0{
        conn.execute("ALTER TABLE collections ADD COLUMN joined INTEGER NOT NULL DEFAULT 0",[])?;
        conn.execute("UPDATE collections SET joined=1 WHERE EXISTS(SELECT 1 FROM item_collections ic WHERE ic.collection_key=collections.key)",[])?;
    }
    let has_journal_abbreviation=conn.query_row("SELECT COUNT(*) FROM pragma_table_info('items') WHERE name='journal_abbreviation'",[],|row|row.get::<_,i64>(0))?;
    if has_journal_abbreviation==0{
        conn.execute("ALTER TABLE items ADD COLUMN journal_abbreviation TEXT NOT NULL DEFAULT ''",[])?;
    }
    Ok(Arc::new(Mutex::new(conn)))
}

fn parse_json<T: serde::de::DeserializeOwned + Default>(value: String) -> T {
    serde_json::from_str(&value).unwrap_or_default()
}

fn paper_from_row(row: &Row<'_>) -> rusqlite::Result<Paper> {
    Ok(Paper {
        id: row.get("id")?, zotero_key: row.get("zotero_key")?, zotero_version: row.get("zotero_version")?,
        title: row.get("title")?, title_zh: row.get("title_zh")?, one_sentence: row.get("one_sentence")?,
        creators: parse_json(row.get::<_, String>("creators_json")?), year: row.get("year")?,
        publication: row.get("publication")?, journal_abbreviation: row.get("journal_abbreviation")?, abstract_note: row.get("abstract_note")?, doi: row.get("doi")?,
        url: row.get("url")?, item_type: row.get("item_type")?, tags: parse_json(row.get::<_, String>("tags_json")?),
        collections: Vec::new(), pdf_state: row.get("pdf_state")?, parse_state: row.get("parse_state")?,
        ai_state: row.get("ai_state")?, zotero_state: row.get("zotero_state")?, local_state: row.get("local_state")?,
        read_state: row.get("read_state")?, main_pdf_key: row.get("main_pdf_key")?,
        needs_pdf_choice: row.get::<_, i64>("needs_pdf_choice")? != 0, error: row.get("error")?,
        interpretation_id: row.get("interpretation_id")?, pending_zotero_trash: row.get::<_, i64>("pending_zotero_trash")? != 0,
        updated_at: row.get("updated_at")?, imported_at: row.get("imported_at")?,
    })
}

fn load_collections(conn: &Connection, paper: &mut Paper) -> Result<()> {
    let mut stmt = conn.prepare("SELECT collection_key FROM item_collections WHERE item_id=?1")?;
    paper.collections = stmt.query_map([&paper.id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(())
}

pub fn list_papers(db: &SharedDb, query: LibraryQuery) -> Result<Vec<Paper>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut sql = String::from("SELECT * FROM items WHERE local_state != 'permanently_deleted'");
    let mut values: Vec<String> = Vec::new();
    match query.view.as_deref() {
        Some("trash") => sql.push_str(" AND local_state='trash'"),
        _ => sql.push_str(" AND local_state='active'"),
    }
    if let Some(search) = query.search.filter(|s| !s.trim().is_empty()) {
        sql.push_str(" AND (title LIKE ? OR title_zh LIKE ? OR one_sentence LIKE ? OR abstract_note LIKE ? OR EXISTS (SELECT 1 FROM notes n WHERE n.item_id=items.id AND n.deleted=0 AND n.content LIKE ?))");
        let needle = format!("%{}%", search.trim());
        values.extend(std::iter::repeat_n(needle, 5));
    }
    if let Some(collection) = query.collection.filter(|s| !s.is_empty() && s != "all") {
        sql.push_str(" AND EXISTS (SELECT 1 FROM item_collections ic WHERE ic.item_id=items.id AND ic.collection_key IN (WITH RECURSIVE descendants(key) AS (SELECT ? UNION ALL SELECT c.key FROM collections c JOIN descendants d ON c.parent_key=d.key WHERE c.deleted=0) SELECT key FROM descendants))");
        values.push(collection);
    }
    match query.status.as_deref() {
        Some("unread") => sql.push_str(" AND read_state='unread'"),
        Some("read") => sql.push_str(" AND read_state='read'"),
        Some("failed") => sql.push_str(" AND (parse_state='failed' OR ai_state='failed')"),
        _ => {}
    }
    sql.push_str(match query.sort.as_deref() {
        Some("title") => " ORDER BY COALESCE(NULLIF(title_zh,''),title) COLLATE NOCASE ASC",
        Some("year") => " ORDER BY year DESC, updated_at DESC",
        _ => " ORDER BY updated_at DESC",
    });
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values.iter()), paper_from_row)?;
    let mut papers = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    for paper in &mut papers { load_collections(&conn, paper)?; }
    Ok(papers)
}

pub fn get_paper(db: &SharedDb, id: &str) -> Result<Paper> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut paper = conn.query_row("SELECT * FROM items WHERE id=?1", [id], paper_from_row)
        .optional()?.context("文献不存在")?;
    load_collections(&conn, &mut paper)?;
    Ok(paper)
}

pub fn paper_by_zotero_key(db: &SharedDb, key: &str) -> Result<Option<Paper>> {
    let conn=db.lock().map_err(|_|anyhow::anyhow!("数据库锁定失败"))?;
    let mut paper=conn.query_row("SELECT * FROM items WHERE zotero_key=?1",[key],paper_from_row).optional()?;
    if let Some(paper)=paper.as_mut(){load_collections(&conn,paper)?;}
    Ok(paper)
}

pub fn get_detail(db: &SharedDb, id: &str) -> Result<PaperDetail> {
    let paper = get_paper(db, id)?;
    let interpretation = if paper.pdf_state == "available" {
        paper.interpretation_id.as_ref().and_then(|iid| get_interpretation(db, iid).ok())
    } else {
        None
    };
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let note = conn.query_row("SELECT content FROM notes WHERE item_id=?1 AND locator IS NULL AND deleted=0 ORDER BY updated_at DESC LIMIT 1", [id], |r| r.get(0)).optional()?.unwrap_or_default();
    Ok(PaperDetail { paper, interpretation, note })
}

pub fn get_interpretation(db: &SharedDb, id: &str) -> Result<Interpretation> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.query_row("SELECT * FROM interpretations WHERE id=?1", [id], |r| Ok(Interpretation {
        id: r.get("id")?, item_id: r.get("item_id")?, markdown_version_id: r.get("markdown_version_id")?,
        title_zh: r.get("title_zh")?, one_sentence: r.get("one_sentence")?,
        sections: parse_json(r.get::<_, String>("sections_json")?), figures: parse_json(r.get::<_, String>("figures_json")?),
        model: r.get("model")?, created_at: r.get("created_at")?,
    })).optional()?.context("解读不存在")
}

pub fn list_collections(db: &SharedDb) -> Result<Vec<Collection>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("WITH RECURSIVE collection_tree(root_key,key) AS (SELECT key,key FROM collections WHERE deleted=0 UNION ALL SELECT ct.root_key,c.key FROM collection_tree ct JOIN collections c ON c.parent_key=ct.key WHERE c.deleted=0) SELECT c.key,c.name,c.parent_key,COUNT(DISTINCT i.id),COUNT(DISTINCT CASE WHEN i.pdf_state='available' THEN i.id END),COUNT(DISTINCT CASE WHEN i.pdf_state='available' AND i.interpretation_id IS NOT NULL THEN i.id END),c.joined FROM collections c LEFT JOIN collection_tree ct ON ct.root_key=c.key LEFT JOIN item_collections ic ON ic.collection_key=ct.key LEFT JOIN items i ON i.id=ic.item_id AND i.local_state='active' WHERE c.deleted=0 GROUP BY c.key ORDER BY c.name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| Ok(Collection { key:r.get(0)?, name:r.get(1)?, parent_key:r.get(2)?, item_count:r.get(3)?, pdf_count:r.get(4)?, interpreted_count:r.get(5)?, joined:r.get::<_,i64>(6)?!=0 }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn stats(db: &SharedDb) -> Result<LibraryStats> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    Ok(LibraryStats {
        total: conn.query_row("SELECT COUNT(*) FROM items WHERE local_state='active'", [], |r| r.get(0))?,
        unread: conn.query_row("SELECT COUNT(*) FROM items WHERE local_state='active' AND read_state='unread'", [], |r| r.get(0))?,
        processing: conn.query_row("SELECT COUNT(*) FROM items WHERE local_state='active' AND pdf_state='available' AND (parse_state IN ('queued','processing','retry_wait') OR ai_state IN ('queued','generating','vision_wait'))", [], |r| r.get(0))?,
        trash: conn.query_row("SELECT COUNT(*) FROM items WHERE local_state='trash'", [], |r| r.get(0))?,
        pending_sync: conn.query_row("SELECT COUNT(*) FROM items WHERE local_state='trash' AND pending_zotero_trash=1", [], |r| r.get(0))?,
        notes: conn.query_row("SELECT COUNT(*) FROM notes WHERE deleted=0", [], |r| r.get(0))?,
    })
}

pub fn upsert_collection(db: &SharedDb, collection: &Collection, version: i64) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("INSERT INTO collections(key,name,parent_key,version) VALUES(?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET name=excluded.name,parent_key=excluded.parent_key,version=excluded.version,deleted=0", params![collection.key,collection.name,collection.parent_key,version])?;
    Ok(())
}

pub fn mark_collections_joined(db: &SharedDb, keys: &BTreeSet<String>) -> Result<()> {
    let conn=db.lock().map_err(|_|anyhow::anyhow!("数据库锁定失败"))?;
    for key in keys{conn.execute("UPDATE collections SET joined=1 WHERE key=?1",[key])?;}
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_paper(db: &SharedDb, key: &str, version: i64, title: &str, creators: &[String], year: Option<i32>, publication: &str, journal_abbreviation: &str, abstract_note: &str, doi: &str, url: &str, item_type: &str, tags: &[String], trashed: bool) -> Result<String> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(r#"INSERT INTO items(id,zotero_key,zotero_version,title,creators_json,year,publication,journal_abbreviation,abstract_note,doi,url,item_type,tags_json,zotero_state,updated_at,imported_at)
 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)
 ON CONFLICT(zotero_key) DO UPDATE SET zotero_version=excluded.zotero_version,title=excluded.title,creators_json=excluded.creators_json,year=excluded.year,publication=excluded.publication,journal_abbreviation=excluded.journal_abbreviation,abstract_note=excluded.abstract_note,doi=excluded.doi,url=excluded.url,item_type=excluded.item_type,tags_json=excluded.tags_json,zotero_state=excluded.zotero_state,updated_at=excluded.updated_at"#,
 params![uuid::Uuid::new_v4().to_string(),key,version,title,serde_json::to_string(creators)?,year,publication,journal_abbreviation,abstract_note,doi,url,item_type,serde_json::to_string(tags)?,if trashed{"trashed"}else{"active"},now])?;
    Ok(conn.query_row("SELECT id FROM items WHERE zotero_key=?1",[key],|r|r.get(0))?)
}

pub fn set_item_collections(db: &SharedDb, item_id: &str, keys: &[String]) -> Result<()> {
    let mut conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM item_collections WHERE item_id=?1",[item_id])?;
    for key in keys { tx.execute("INSERT OR IGNORE INTO item_collections(item_id,collection_key) VALUES(?1,?2)",params![item_id,key])?; }
    tx.commit()?;
    Ok(())
}

pub fn set_state(db: &SharedDb, item_id: &str, field: &str, value: &str) -> Result<()> {
    if !["pdf_state","parse_state","ai_state","zotero_state","local_state","read_state"].contains(&field) { anyhow::bail!("不支持的状态字段"); }
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    if field == "read_state" {
        conn.execute("UPDATE items SET read_state=?1 WHERE id=?2",params![value,item_id])?;
    } else {
        conn.execute(&format!("UPDATE items SET {field}=?1,updated_at=?2 WHERE id=?3"),params![value,Utc::now().to_rfc3339(),item_id])?;
    }
    Ok(())
}

pub fn set_error(db: &SharedDb, item_id: &str, error: Option<&str>) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE items SET error=?1,updated_at=?2 WHERE id=?3",params![error,Utc::now().to_rfc3339(),item_id])?;
    Ok(())
}

pub fn set_main_pdf(db: &SharedDb, item_id: &str, key: Option<&str>, needs_choice: bool) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE items SET main_pdf_key=?1,needs_pdf_choice=?2,pdf_state=?3,updated_at=?4 WHERE id=?5",params![key,needs_choice as i64,if key.is_some(){"available"}else{"unavailable"},Utc::now().to_rfc3339(),item_id])?;
    Ok(())
}

pub fn replace_attachments(db: &SharedDb, item_id: &str, attachments: &[Attachment]) -> Result<()> {
    let mut conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM attachments WHERE item_id=?1",[item_id])?;
    for a in attachments { tx.execute("INSERT INTO attachments(item_id,zotero_key,title,filename,content_type) VALUES(?1,?2,?3,?4,'application/pdf')",params![item_id,a.key,a.title,a.filename])?; }
    tx.commit()?;
    Ok(())
}

pub fn attachments(db: &SharedDb, item_id: &str) -> Result<Vec<Attachment>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("SELECT zotero_key,title,filename FROM attachments WHERE item_id=?1")?;
    let rows = stmt.query_map([item_id],|r|Ok(Attachment{key:r.get(0)?,title:r.get(1)?,filename:r.get(2)?}))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn save_markdown(db: &SharedDb, item_id: &str, path: &str, sha256: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("INSERT INTO markdown_versions(id,item_id,path,sha256,created_at) VALUES(?1,?2,?3,?4,?5)",params![id,item_id,path,sha256,Utc::now().to_rfc3339()])?;
    Ok(id)
}

pub fn latest_markdown(db: &SharedDb, item_id: &str) -> Result<Option<(String,String)>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    Ok(conn.query_row("SELECT id,path FROM markdown_versions WHERE item_id=?1 ORDER BY created_at DESC LIMIT 1",[item_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?)
}

pub fn save_interpretation(db: &SharedDb, item_id: &str, markdown_version_id: Option<&str>, title_zh: &str, one_sentence: &str, sections: &[Section], figures: &[Figure], model: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let mut conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO interpretations(id,item_id,markdown_version_id,title_zh,one_sentence,sections_json,figures_json,model,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,item_id,markdown_version_id,title_zh,one_sentence,serde_json::to_string(sections)?,serde_json::to_string(figures)?,model,now])?;
    tx.execute("UPDATE items SET interpretation_id=?1,title_zh=?2,one_sentence=?3,ai_state='succeeded',error=NULL,updated_at=?4 WHERE id=?5",params![id,title_zh,one_sentence,now,item_id])?;
    tx.commit()?;
    Ok(id)
}

pub fn save_note(db: &SharedDb, item_id: &str, content: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    if content.trim().is_empty() {
        conn.execute("UPDATE notes SET deleted=1,updated_at=?1 WHERE item_id=?2 AND locator IS NULL",params![now,item_id])?;
    } else {
        conn.execute(r#"INSERT INTO notes(id,item_id,content,created_at,updated_at) SELECT ?1,?2,?3,?4,?4 WHERE NOT EXISTS(SELECT 1 FROM notes WHERE item_id=?2 AND locator IS NULL AND deleted=0)"#,params![uuid::Uuid::new_v4().to_string(),item_id,content.trim(),now])?;
        conn.execute("UPDATE notes SET content=?1,updated_at=?2 WHERE item_id=?3 AND locator IS NULL AND deleted=0",params![content.trim(),now,item_id])?;
    }
    Ok(())
}

fn note_from_row(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note{id:row.get("id")?,item_id:row.get("item_id")?,interpretation_id:row.get("interpretation_id")?,title:row.get("title")?,content:row.get("content")?,locator:row.get("locator")?,updated_at:row.get("updated_at")?})
}

pub fn create_anchored_note(db: &SharedDb, item_id: &str, interpretation_id: &str, content: &str, locator: &NoteLocator) -> Result<String> {
    if locator.exact.trim().is_empty() || locator.end < locator.start { anyhow::bail!("选段定位无效"); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let locator_json = serde_json::to_string(locator)?;
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("INSERT INTO notes(id,item_id,interpretation_id,content,locator,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",params![id,item_id,interpretation_id,content.trim(),locator_json,now])?;
    Ok(id)
}

pub fn list_item_notes(db: &SharedDb, item_id: &str) -> Result<Vec<Note>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("SELECT * FROM notes WHERE item_id=?1 AND locator IS NOT NULL AND deleted=0 ORDER BY created_at")?;
    let rows = stmt.query_map([item_id], note_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn update_anchored_note(db: &SharedDb, note_id: &str, content: &str, locator: &NoteLocator) -> Result<()> {
    if locator.exact.trim().is_empty() || locator.end < locator.start { anyhow::bail!("选段定位无效"); }
    let locator_json = serde_json::to_string(locator)?;
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let changed = conn.execute("UPDATE notes SET content=?1,locator=?2,updated_at=?3 WHERE id=?4 AND locator IS NOT NULL AND deleted=0",params![content.trim(),locator_json,Utc::now().to_rfc3339(),note_id])?;
    if changed == 0 { anyhow::bail!("选段备忘不存在"); }
    Ok(())
}

pub fn delete_anchored_note(db: &SharedDb, note_id: &str) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let changed = conn.execute("UPDATE notes SET deleted=1,updated_at=?1 WHERE id=?2 AND locator IS NOT NULL AND deleted=0",params![Utc::now().to_rfc3339(),note_id])?;
    if changed == 0 { anyhow::bail!("选段备忘不存在"); }
    Ok(())
}

pub fn list_notes(db: &SharedDb, search: Option<&str>) -> Result<Vec<Note>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let pattern = format!("%{}%",search.unwrap_or_default());
    let mut stmt = conn.prepare("SELECT * FROM notes WHERE deleted=0 AND (content LIKE ?1 OR locator LIKE ?1) ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([pattern], note_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn list_qa(db: &SharedDb, item_id: &str) -> Result<Vec<QaMessage>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("SELECT * FROM qa_messages WHERE item_id=?1 AND deleted=0 ORDER BY created_at")?;
    let rows = stmt.query_map([item_id],|r|Ok(QaMessage{id:r.get("id")?,item_id:r.get("item_id")?,role:r.get("role")?,content:r.get("content")?,sources:parse_json(r.get::<_,String>("sources_json")?),visual_refs:parse_json(r.get::<_,String>("visual_json")?),inference:r.get::<_,i64>("inference")?!=0,usage:r.get::<_,Option<String>>("usage_json")?.and_then(|v|serde_json::from_str(&v).ok()),created_at:r.get("created_at")?}))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn add_qa(db: &SharedDb, item_id: &str, role: &str, content: &str, sources: &[String], visual_refs: &[String], inference: bool, usage: Option<&serde_json::Value>) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("INSERT INTO qa_messages(id,item_id,role,content,sources_json,visual_json,inference,usage_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,item_id,role,content,serde_json::to_string(sources)?,serde_json::to_string(visual_refs)?,inference as i64,usage.map(|u|u.to_string()),Utc::now().to_rfc3339()])?;
    Ok(id)
}

pub fn clear_qa(db: &SharedDb, item_id: &str) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE qa_messages SET deleted=1 WHERE item_id=?1",[item_id])?;
    Ok(())
}

pub fn trash_item(db: &SharedDb, item_id: &str) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE items SET local_state='trash',pending_zotero_trash=1,deleted_at=?1,updated_at=?1 WHERE id=?2",params![Utc::now().to_rfc3339(),item_id])?;
    Ok(())
}

pub fn restore_item(db: &SharedDb, item_id: &str) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE items SET local_state='active',pending_zotero_trash=0,deleted_at=NULL,updated_at=?1 WHERE id=?2",params![Utc::now().to_rfc3339(),item_id])?;
    Ok(())
}

pub fn pending_trash(db: &SharedDb) -> Result<Vec<Paper>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("SELECT * FROM items WHERE local_state='trash' AND pending_zotero_trash=1")?;
    let rows = stmt.query_map([],paper_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn mark_zotero_trashed(db: &SharedDb, item_id: &str) -> Result<()> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    conn.execute("UPDATE items SET pending_zotero_trash=0,zotero_state='trashed',updated_at=?1 WHERE id=?2",params![Utc::now().to_rfc3339(),item_id])?;
    Ok(())
}

pub fn active_keys(db: &SharedDb) -> Result<Vec<String>> {
    let conn = db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
    let mut stmt = conn.prepare("SELECT zotero_key FROM items WHERE local_state!='permanently_deleted'")?;
    let rows = stmt.query_map([],|r|r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sync_is_idempotent_and_preserves_ai_fields() {
        let db = open(Path::new(":memory:")).unwrap();
        let id = upsert_paper(&db,"ABC",1,"Old",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        save_interpretation(&db,&id,None,"中文标题","一句话",&[],&[],"test").unwrap();
        let same = upsert_paper(&db,"ABC",2,"New",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        assert_eq!(id,same);
        let p = get_paper(&db,&id).unwrap();
        assert_eq!(p.title,"New"); assert_eq!(p.title_zh,"中文标题"); assert_eq!(p.one_sentence,"一句话");
    }
    #[test]
    fn read_state_changes_preserve_update_order() {
        let db = open(Path::new(":memory:")).unwrap();
        let first = upsert_paper(&db,"FIRST",1,"First",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        let second = upsert_paper(&db,"SECOND",1,"Second",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        {
            let conn = db.lock().unwrap();
            conn.execute("UPDATE items SET updated_at='2024-01-01T00:00:00Z' WHERE id=?1",[&first]).unwrap();
            conn.execute("UPDATE items SET updated_at='2024-01-02T00:00:00Z' WHERE id=?1",[&second]).unwrap();
        }
        let updated_at = get_paper(&db,&first).unwrap().updated_at;
        set_state(&db,&first,"read_state","reading").unwrap();
        assert_eq!(get_paper(&db,&first).unwrap().updated_at,updated_at);
        let papers = list_papers(&db,LibraryQuery{search:None,collection:None,status:None,view:None,sort:None}).unwrap();
        assert_eq!(papers.iter().map(|paper|paper.id.as_str()).collect::<Vec<_>>(),vec![second,first]);
    }

    #[test]
    fn regenerating_interpretation_preserves_read_state(){
        let db=open(Path::new(":memory:")).unwrap();
        let id=upsert_paper(&db,"READ",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        set_state(&db,&id,"read_state","read").unwrap();
        save_interpretation(&db,&id,None,"中文标题","一句话",&[],&[],"test").unwrap();
        assert_eq!(get_paper(&db,&id).unwrap().read_state,"read");
    }

    #[test]
    fn notes_are_searchable() {
        let db = open(Path::new(":memory:")).unwrap();
        let id = upsert_paper(&db,"N1",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        save_note(&db,&id,"独特的研究方法").unwrap();
        assert_eq!(list_papers(&db,LibraryQuery{search:Some("研究方法".into()),collection:None,status:None,view:None,sort:None}).unwrap().len(),1);
    }

    #[test]
    fn anchored_notes_crud_preserves_general_note_and_searches_quote() {
        let db = open(Path::new(":memory:")).unwrap();
        let id = upsert_paper(&db,"ANCHOR",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        save_note(&db,&id,"整篇总备忘").unwrap();
        assert_eq!(stats(&db).unwrap().notes,1);
        let locator = NoteLocator{version:1,section_index:2,section_title:"研究方法".into(),exact:"随机分配的准实验设计".into(),prefix:"研究采用".into(),suffix:"并记录过程".into(),start:4,end:15,color:HighlightColor::Yellow};
        let note_id = create_anchored_note(&db,&id,"interpretation-v1","需要复核随机化过程",&locator).unwrap();
        assert_eq!(stats(&db).unwrap().notes,2);
        let notes = list_item_notes(&db,&id).unwrap();
        assert_eq!(notes.len(),1);
        assert_eq!(notes[0].interpretation_id.as_deref(),Some("interpretation-v1"));
        assert_eq!(get_detail(&db,&id).unwrap().note,"整篇总备忘");
        let updated_locator = NoteLocator{color:HighlightColor::Green,..locator};
        update_anchored_note(&db,&note_id,"已核对分配隐藏",&updated_locator).unwrap();
        assert_eq!(stats(&db).unwrap().notes,2);
        let updated = list_item_notes(&db,&id).unwrap().remove(0);
        assert_eq!(updated.content,"已核对分配隐藏");
        assert_eq!(serde_json::from_str::<NoteLocator>(&updated.locator.unwrap()).unwrap().color,HighlightColor::Green);
        assert_eq!(list_notes(&db,Some("准实验设计")).unwrap().len(),1);
        delete_anchored_note(&db,&note_id).unwrap();
        assert!(list_item_notes(&db,&id).unwrap().is_empty());
        assert_eq!(stats(&db).unwrap().notes,1);
        assert_eq!(get_detail(&db,&id).unwrap().note,"整篇总备忘");
    }

    #[test]
    fn anchored_notes_allow_blank_memo_and_validate_records() {
        let db = open(Path::new(":memory:")).unwrap();
        let id = upsert_paper(&db,"ANCHOR-VALIDATION",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        let locator = NoteLocator{version:1,section_index:0,section_title:"基本信息".into(),exact:"有效引用".into(),prefix:String::new(),suffix:String::new(),start:0,end:4,color:HighlightColor::Blue};
        create_anchored_note(&db,&id,"interpretation-v1"," ",&locator).unwrap();
        assert_eq!(list_item_notes(&db,&id).unwrap()[0].content,"");
        assert!(create_anchored_note(&db,&id,"interpretation-v1","有效备忘",&NoteLocator{exact:String::new(),..locator.clone()}).is_err());
        assert!(update_anchored_note(&db,"missing","内容",&locator).is_err());
        assert!(delete_anchored_note(&db,"missing").is_err());
    }

    #[test]
    fn joined_state_is_explicit_even_for_empty_collections(){
        let db=open(Path::new(":memory:")).unwrap();
        for key in ["JOINED","RELATED"]{upsert_collection(&db,&Collection{key:key.into(),name:key.into(),parent_key:None,item_count:0,pdf_count:0,interpreted_count:0,joined:false},0).unwrap();}
        let id=upsert_paper(&db,"RELATED-PAPER",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        set_item_collections(&db,&id,&["RELATED".into()]).unwrap();
        mark_collections_joined(&db,&BTreeSet::from(["JOINED".into()])).unwrap();
        let collections=list_collections(&db).unwrap();
        assert!(collections.iter().find(|c|c.key=="JOINED").unwrap().joined);
        assert!(!collections.iter().find(|c|c.key=="RELATED").unwrap().joined);
    }

    #[test]
    fn nested_collection_queries_and_stats_include_descendants_without_duplicates(){
        let db=open(Path::new(":memory:")).unwrap();
        upsert_collection(&db,&Collection{key:"PARENT".into(),name:"Parent".into(),parent_key:None,item_count:0,pdf_count:0,interpreted_count:0,joined:true},0).unwrap();
        upsert_collection(&db,&Collection{key:"CHILD".into(),name:"Child".into(),parent_key:Some("PARENT".into()),item_count:0,pdf_count:0,interpreted_count:0,joined:true},0).unwrap();
        let direct=upsert_paper(&db,"DIRECT",1,"Direct",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        let nested=upsert_paper(&db,"NESTED",1,"Nested",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        set_item_collections(&db,&direct,&["PARENT".into()]).unwrap();
        set_item_collections(&db,&nested,&["PARENT".into(),"CHILD".into()]).unwrap();
        set_main_pdf(&db,&nested,Some("PDF"),false).unwrap();
        save_interpretation(&db,&nested,None,"嵌套文献","一句话",&[],&[],"test").unwrap();
        let query=|key:&str|list_papers(&db,LibraryQuery{search:None,collection:Some(key.into()),status:None,view:None,sort:None}).unwrap();
        assert_eq!(query("PARENT").len(),2);
        assert_eq!(query("CHILD").len(),1);
        let collections=list_collections(&db).unwrap();
        let parent=collections.iter().find(|collection|collection.key=="PARENT").unwrap();
        assert_eq!((parent.item_count,parent.pdf_count,parent.interpreted_count),(2,1,1));
    }

    #[test]
    fn legacy_collections_with_items_are_marked_joined_during_migration(){
        let temp=tempfile::tempdir().unwrap();
        let path=temp.path().join("legacy.db");
        let conn=Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE collections(key TEXT PRIMARY KEY,name TEXT NOT NULL,parent_key TEXT,version INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0);CREATE TABLE item_collections(item_id TEXT NOT NULL,collection_key TEXT NOT NULL,PRIMARY KEY(item_id,collection_key));INSERT INTO collections(key,name) VALUES('LEGACY','Legacy');INSERT INTO item_collections VALUES('OLD-ITEM','LEGACY');").unwrap();
        drop(conn);
        let db=open(&path).unwrap();
        assert!(list_collections(&db).unwrap()[0].joined);
    }
}
