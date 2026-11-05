use crate::{db, models::*};
use anyhow::{Context, Result};
use reqwest::{header::HeaderMap, Client, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

const API_VERSION: &str = "3";
const MAX_PDF_SIZE: u64 = 1024*1024*1024;

#[derive(Clone)]
pub struct ZoteroClient { http: Client, base: String }

#[derive(Debug, Deserialize)]
struct AuthorizeResponse { key: String, #[serde(default)] remember: bool }

fn existing_file(path: PathBuf) -> Option<PathBuf> { path.is_file().then_some(path) }

/// Convert Zotero's attachment path forms without consulting zotero.sqlite.
/// `data_dir` may be either the Zotero root or its storage directory.
pub fn resolve_attachment_path(path: &str, filename: Option<&str>, item_key: &str, root_dir: Option<&Path>, data_dir: Option<&Path>) -> Option<PathBuf> {
    let raw=path.trim();
    if !raw.is_empty()&&raw!="N/A" {
        let absolute=Path::new(raw);
        if absolute.is_absolute() { if let Some(path)=existing_file(absolute.to_path_buf()){return Some(path);} }
        if let Some(relative)=raw.strip_prefix("attachments:") {
            return root_dir.and_then(|root|existing_file(root.join(relative)));
        }
        if let Some(relative)=raw.strip_prefix("storage:") {
            if let Some(data)=data_dir {
                if let Some(path)=existing_file(data.join(relative)){return Some(path);}
                if let Some(path)=existing_file(data.join("storage").join(relative)){return Some(path);}
            }
        }
    }
    let filename=filename.filter(|name|!name.trim().is_empty())?;
    if item_key.is_empty(){return None;}
    let data=data_dir?;
    existing_file(data.join("storage").join(item_key).join(filename))
        .or_else(||existing_file(data.join(item_key).join(filename)))
}

fn configured_data_dir() -> Option<PathBuf> {
    if let Some(path)=crate::environment::get("ZOTERO_DATA_DIR"){return Some(PathBuf::from(path));}
    let home=std::env::var_os("HOME").or_else(||std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join("Zotero"))
}

fn local_attachment_path(item: &Value, key: &str) -> Option<PathBuf> {
    let data=item.get("data")?;
    let path=data.get("path").and_then(Value::as_str).unwrap_or_default();
    let filename=data.get("filename").and_then(Value::as_str);
    let root=crate::environment::get("ZOTERO_ROOT_DIR").map(PathBuf::from);
    let data_dir=configured_data_dir();
    resolve_attachment_path(path,filename,key,root.as_deref(),data_dir.as_deref())
}

impl ZoteroClient {
    pub fn new(http: Client, base: &str) -> Self { Self { http, base: base.trim_end_matches('/').into() } }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http.request(method, format!("{}{}", self.base, path)).header("Zotero-API-Version", API_VERSION)
    }

    pub async fn check(&self) -> Result<()> {
        let response = self.request(reqwest::Method::GET, "/collections?limit=1").send().await
            .context("无法连接 Zotero。请确认 Zotero 已启动，并允许本机 HTTP API。")?;
        if !response.status().is_success() { anyhow::bail!("Zotero 返回 {}：{}", response.status(), response.text().await.unwrap_or_default()); }
        Ok(())
    }

    async fn get_page(&self, path: &str) -> Result<(Vec<Value>, HeaderMap)> {
        let response = self.request(reqwest::Method::GET, path).send().await?;
        let status = response.status();
        let headers = response.headers().clone();
        if !status.is_success() { anyhow::bail!("Zotero 请求失败（{}）：{}", status, response.text().await.unwrap_or_default()); }
        Ok((response.json().await?, headers))
    }

    pub async fn fetch_all(&self, path: &str) -> Result<Vec<Value>> {
        let mut all = Vec::new();
        let mut start = 0usize;
        loop {
            let separator = if path.contains('?') { '&' } else { '?' };
            let page_path = format!("{}{}limit=100&start={}", path, separator, start);
            let (page, headers) = self.get_page(&page_path).await?;
            let count = page.len();
            all.extend(page);
            let total = headers.get("Total-Results").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<usize>().ok()).unwrap_or(all.len());
            start += count;
            if count == 0 || start >= total { break; }
        }
        Ok(all)
    }

    pub async fn collections(&self) -> Result<Vec<Collection>> {
        Ok(self.fetch_all("/collections").await?.iter().filter_map(|v| {
            let data = v.get("data")?;
            Some(Collection { key:v.get("key")?.as_str()?.into(), name:data.get("name")?.as_str()?.into(), parent_key:data.get("parentCollection").and_then(|p|if p.is_string(){p.as_str().map(Into::into)}else{None}), item_count:0, joined:false })
        }).collect())
    }

    pub fn selected_collections(all: &[Collection], selected: &[String]) -> BTreeSet<String> {
        let mut result = BTreeSet::new();
        let mut pending: Vec<String> = selected.to_vec();
        while let Some(key) = pending.pop() {
            if !result.insert(key.clone()) { continue; }
            pending.extend(all.iter().filter(|c|c.parent_key.as_ref()==Some(&key)).map(|c|c.key.clone()));
        }
        result
    }

    pub async fn top_items(&self, collection_keys: &BTreeSet<String>) -> Result<Vec<Value>> {
        let mut items = BTreeMap::new();
        for key in collection_keys {
            for item in self.fetch_all(&format!("/collections/{}/items/top",key)).await? {
                if let Some(key) = item.get("key").and_then(Value::as_str) { items.insert(key.to_string(),item); }
            }
        }
        Ok(items.into_values().collect())
    }

    pub async fn pdf_attachments(&self, item: &Value) -> Result<Vec<Attachment>> {
        let Some(key) = item.get("key").and_then(Value::as_str) else { return Ok(Vec::new()); };
        let data = item.get("data").cloned().unwrap_or_default();
        if data.get("itemType").and_then(Value::as_str)==Some("attachment") && data.get("contentType").and_then(Value::as_str)==Some("application/pdf") {
            return Ok(vec![attachment_from_value(item)]);
        }
        Ok(self.fetch_all(&format!("/items/{}/children",key)).await?.iter().filter(|child| {
            let d=child.get("data").unwrap_or(&Value::Null);
            d.get("itemType").and_then(Value::as_str)==Some("attachment") && d.get("contentType").and_then(Value::as_str)==Some("application/pdf")
        }).map(attachment_from_value).collect())
    }

    async fn read_local_file(path:&Path) -> Result<Vec<u8>> {
        let size=tokio::fs::metadata(path).await.with_context(||format!("无法读取 PDF 文件信息：{}",path.display()))?.len();
        if size>MAX_PDF_SIZE{anyhow::bail!("PDF 超过 1 GiB 限制");}
        tokio::fs::read(path).await.with_context(||format!("无法读取 Zotero PDF：{}",path.display()))
    }

    pub async fn file(&self, key: &str) -> Result<Vec<u8>> {
        // Prefer Zotero's own path metadata so linked and stored attachments both work.
        // The file endpoint remains a fallback for attachments without a usable local path.
        if let Ok(response)=self.request(reqwest::Method::GET,&format!("/items/{}",key)).send().await {
            if response.status().is_success() {
                if let Ok(item)=response.json::<Value>().await {
                    if let Some(path)=local_attachment_path(&item,key) { return Self::read_local_file(&path).await; }
                }
            }
        }
        let response = self.request(reqwest::Method::GET,&format!("/items/{}/file",key)).send().await?;
        if response.status().is_redirection() {
            let location=response.headers().get(reqwest::header::LOCATION).and_then(|value|value.to_str().ok()).context("Zotero 的文件重定向缺少 Location")?;
            let url=url::Url::parse(location).context("Zotero 返回了无效的文件重定向")?;
            if url.scheme()!="file"{anyhow::bail!("Zotero 返回了不支持的网络重定向；仅允许读取本机 file:// PDF");}
            let path=url.to_file_path().map_err(|_|anyhow::anyhow!("Zotero 返回了无效的本机 PDF 路径"))?;
            return Self::read_local_file(&path).await;
        }
        if !response.status().is_success() { anyhow::bail!("无法读取 Zotero PDF（{}）。请检查附件路径，以及 ZOTERO_DATA_DIR / ZOTERO_ROOT_DIR 配置",response.status()); }
        let bytes = response.bytes().await?;
        if bytes.len() as u64>MAX_PDF_SIZE { anyhow::bail!("PDF 超过 1 GiB 限制"); }
        Ok(bytes.to_vec())
    }

    async fn check_local_file(path:&Path)->Result<()> {
        let size=tokio::fs::metadata(path).await.with_context(||format!("无法读取 PDF 文件信息：{}",path.display()))?.len();
        if size>MAX_PDF_SIZE{anyhow::bail!("PDF 超过 1 GiB 限制");}
        let mut file=tokio::fs::File::open(path).await.with_context(||format!("无法打开 Zotero PDF：{}",path.display()))?;
        let mut prefix=[0u8;5];tokio::io::AsyncReadExt::read_exact(&mut file,&mut prefix).await.with_context(||format!("PDF 文件头不完整：{}",path.display()))?;
        if &prefix!=b"%PDF-"{anyhow::bail!("附件不是有效 PDF：{}",path.display());}
        Ok(())
    }

    /// Validate attachment paths before import without downloading the whole PDF.
    pub async fn check_file(&self,key:&str)->Result<()> {
        if let Ok(response)=self.request(reqwest::Method::GET,&format!("/items/{}",key)).send().await{
            if response.status().is_success(){
                if let Ok(item)=response.json::<Value>().await{
                    if let Some(path)=local_attachment_path(&item,key){return Self::check_local_file(&path).await;}
                }
            }
        }
        let mut response=self.request(reqwest::Method::GET,&format!("/items/{}/file",key)).header(reqwest::header::RANGE,"bytes=0-4").send().await?;
        if response.status().is_redirection(){
            let location=response.headers().get(reqwest::header::LOCATION).and_then(|value|value.to_str().ok()).context("Zotero 的文件重定向缺少 Location")?;
            let url=url::Url::parse(location).context("Zotero 返回了无效的文件重定向")?;
            if url.scheme()!="file"{anyhow::bail!("Zotero 返回了不支持的网络重定向；仅允许读取本机 file:// PDF");}
            let path=url.to_file_path().map_err(|_|anyhow::anyhow!("Zotero 返回了无效的本机 PDF 路径"))?;
            return Self::check_local_file(&path).await;
        }
        if !response.status().is_success(){anyhow::bail!("无法读取 Zotero PDF（{}）。请检查附件路径和 config.json 中的 Zotero 路径配置",response.status());}
        let mut prefix=Vec::with_capacity(5);
        while prefix.len()<5{let chunk=response.chunk().await?.context("Zotero PDF 文件为空或文件头不完整")?;prefix.extend_from_slice(&chunk);}
        if !prefix.starts_with(b"%PDF-"){anyhow::bail!("Zotero 附件不是有效 PDF");}
        Ok(())
    }

    pub async fn server_id(&self) -> Result<String> {
        let root = self.base.split("/api/").next().context("无效的 Zotero 地址")?;
        let response = self.http.get(format!("{}/api/",root)).header("Zotero-API-Version",API_VERSION).send().await?;
        response.headers().get("Zotero-Server-ID").and_then(|v|v.to_str().ok()).map(str::to_string).context("当前 Zotero 未提供 Server ID；写入回收站需要 Zotero 10 或更新版本")
    }

    pub async fn authorize(&self, server_id: &str) -> Result<(String, bool)> {
        let root = self.base.split("/api/").next().context("无效的 Zotero 地址")?;
        let response = self.http.post(format!("{}/api/local/authorize",root)).header("Zotero-API-Version",API_VERSION).header("Zotero-Server-ID",server_id).json(&json!({"appName":"Zotero Reader"})).send().await?;
        if response.status()==StatusCode::FORBIDDEN { anyhow::bail!("你拒绝了 Zotero 写授权"); }
        if !response.status().is_success() { anyhow::bail!("Zotero 写授权失败（{}）",response.status()); }
        let auth: AuthorizeResponse = response.json().await?;
        Ok((auth.key, auth.remember))
    }

    pub async fn move_to_trash(&self, paper: &Paper, server_id: &str, key: &str) -> Result<()> {
        let response = self.request(reqwest::Method::PATCH,&format!("/items/{}",paper.zotero_key))
            .header("Zotero-Server-ID",server_id).header("Zotero-API-Key",key)
            .header("If-Unmodified-Since-Version",paper.zotero_version).json(&json!({"deleted":1})).send().await?;
        if response.status()==StatusCode::PRECONDITION_FAILED { anyhow::bail!("{} 已在 Zotero 中变化，请先同步再重试",paper.title); }
        if !response.status().is_success() { anyhow::bail!("{} 同步失败（{}）",paper.title,response.status()); }
        Ok(())
    }
}

fn attachment_from_value(value: &Value) -> Attachment {
    let data=value.get("data").unwrap_or(&Value::Null);
    Attachment { key:value.get("key").and_then(Value::as_str).unwrap_or_default().into(), title:data.get("title").and_then(Value::as_str).unwrap_or("PDF 附件").into(), filename:data.get("filename").and_then(Value::as_str).unwrap_or_default().into() }
}

pub struct PdfPreflight{pub with_pdf:usize,pub multiple_pdf:usize,pub issues:Vec<PdfIssue>}

pub async fn preflight_pdfs(zotero:&ZoteroClient,items:&[Value])->Result<PdfPreflight>{
    let mut result=PdfPreflight{with_pdf:0,multiple_pdf:0,issues:Vec::new()};
    for item in items{
        let attachments=zotero.pdf_attachments(item).await?;
        if !attachments.is_empty(){result.with_pdf+=1;}
        if attachments.len()>1{result.multiple_pdf+=1;}
        for attachment in attachments{
            if let Err(error)=zotero.check_file(&attachment.key).await{
                result.issues.push(PdfIssue{
                    item_key:item.get("key").and_then(Value::as_str).unwrap_or_default().to_string(),
                    title:item.get("data").and_then(|data|data.get("title")).and_then(Value::as_str).unwrap_or("未命名文献").to_string(),
                    attachment_key:attachment.key,error:error.to_string(),
                });
            }
        }
    }
    Ok(result)
}

pub fn metadata(item: &Value) -> Result<(String,i64,String,Vec<String>,Option<i32>,String,String,String,String,String,String,Vec<String>,bool)> {
    let key=item.get("key").and_then(Value::as_str).context("条目缺少 key")?.to_string();
    let version=item.get("version").and_then(Value::as_i64).unwrap_or_default();
    let d=item.get("data").unwrap_or(&Value::Null);
    let text=|name:&str|d.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    let creators=d.get("creators").and_then(Value::as_array).map(|a|a.iter().map(|c|c.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(||format!("{} {}",c.get("firstName").and_then(Value::as_str).unwrap_or_default(),c.get("lastName").and_then(Value::as_str).unwrap_or_default()).trim().to_string())).filter(|s|!s.is_empty()).collect()).unwrap_or_default();
    let year=text("date").get(0..4).and_then(|y|y.parse().ok());
    let tags=d.get("tags").and_then(Value::as_array).map(|a|a.iter().filter_map(|t|t.get("tag").and_then(Value::as_str).map(str::to_string)).collect()).unwrap_or_default();
    let publication=if text("publicationTitle").is_empty(){text("bookTitle")}else{text("publicationTitle")};
    let journal_abbreviation=text("journalAbbreviation");
    let trashed=d.get("deleted").and_then(Value::as_i64).unwrap_or_default()==1;
    Ok((key,version,text("title"),creators,year,publication,journal_abbreviation,text("abstractNote"),text("DOI"),text("url"),text("itemType"),tags,trashed))
}

#[derive(Debug, Default, PartialEq)]
struct PdfSync {
    queued: bool,
    choice: bool,
}

fn same_pdf_files(left: &[Attachment], right: &[Attachment]) -> bool {
    let left_files=left.iter().map(|a|(&a.key,&a.filename)).collect::<BTreeSet<_>>();
    let right_files=right.iter().map(|a|(&a.key,&a.filename)).collect::<BTreeSet<_>>();
    left_files==right_files
}

/// Update attachments without discarding a working parse or the reader's PDF choice.
fn sync_pdf(db: &db::SharedDb, item_id: &str, previous: Option<&Paper>, attachments: &[Attachment]) -> Result<PdfSync> {
    let old_attachments=if previous.is_some(){db::attachments(db,item_id)?}else{Vec::new()};
    if previous.is_some()&&same_pdf_files(&old_attachments,attachments){
        if attachments.is_empty(){
            db::set_state(db,item_id,"ai_state","not_started")?;
            db::set_error(db,item_id,None)?;
        }
        return Ok(PdfSync::default());
    }
    db::replace_attachments(db,item_id,attachments)?;
    let retained_main=previous.and_then(|paper|paper.main_pdf_key.as_deref()).filter(|key|attachments.iter().any(|a|&a.key==key));
    if let Some(key)=retained_main {
        db::set_main_pdf(db,item_id,Some(key),false)?;
        return Ok(PdfSync::default());
    }
    match attachments {
        []=>{
            db::set_main_pdf(db,item_id,None,false)?;
            db::set_error(db,item_id,None)?;
            db::set_state(db,item_id,"parse_state","not_started")?;
            db::set_state(db,item_id,"ai_state","not_started")?;
            Ok(PdfSync::default())
        }
        [attachment]=>{
            db::set_main_pdf(db,item_id,Some(&attachment.key),false)?;
            db::set_error(db,item_id,None)?;
            db::set_state(db,item_id,"parse_state","queued")?;
            Ok(PdfSync{queued:true,choice:false})
        }
        _=>{
            db::set_main_pdf(db,item_id,None,true)?;
            db::set_error(db,item_id,Some("请选择主 PDF 后开始解析"))?;
            Ok(PdfSync{queued:false,choice:true})
        }
    }
}

fn readable_attachments(attachments:Vec<Attachment>,unreadable:&BTreeSet<String>)->Vec<Attachment>{
    attachments.into_iter().filter(|attachment|!unreadable.contains(&attachment.key)).collect()
}

async fn upsert_from_zotero(state: &crate::state::AppState, zotero: &ZoteroClient, item: &Value, unreadable:&BTreeSet<String>) -> Result<(String,PdfSync,Vec<Attachment>)> {
    let (key,version,title,creators,year,publication,journal_abbreviation,abstract_note,doi,url,item_type,tags,trashed)=metadata(item)?;
    let previous=db::paper_by_zotero_key(&state.db,&key)?;
    let id=db::upsert_paper(&state.db,&key,version,&title,&creators,year,&publication,&journal_abbreviation,&abstract_note,&doi,&url,&item_type,&tags,trashed)?;
    let item_keys:Vec<String>=item.get("data").and_then(|d|d.get("collections")).and_then(Value::as_array).map(|a|a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    db::set_item_collections(&state.db,&id,&item_keys)?;
    let attachments=readable_attachments(zotero.pdf_attachments(item).await?,unreadable);
    let pdf=sync_pdf(&state.db,&id,previous.as_ref(),&attachments)?;
    Ok((id,pdf,attachments))
}

pub async fn import_collections(state: &crate::state::AppState, selected: &[String]) -> Result<(ImportResult,Vec<PdfChoice>)> {
    let zotero=state.zotero();
    let all=zotero.collections().await?;
    let keys=ZoteroClient::selected_collections(&all,selected);
    if keys.is_empty(){anyhow::bail!("请至少选择一个 Zotero 分类");}
    let items=zotero.top_items(&keys).await?;
    let preflight=preflight_pdfs(&zotero,&items).await?;
    let unreadable:BTreeSet<String>=preflight.issues.iter().map(|issue|issue.attachment_key.clone()).collect();
    for c in &all { db::upsert_collection(&state.db,c,0)?; }
    let mut result=ImportResult{imported:0,queued:0,skipped:0};
    let mut choices=Vec::new();
    for item in items {
        let (id,pdf,attachments)=upsert_from_zotero(state,&zotero,&item,&unreadable).await?;
        result.imported+=1;
        if pdf.queued{result.queued+=1;}
        if pdf.choice{result.skipped+=1;choices.push(PdfChoice{item_id:id,attachments});}
    }
    db::mark_collections_joined(&state.db,&keys)?;
    Ok((result,choices))
}

/// Read-only incremental sync. Zotero owns bibliographic metadata; local AI and notes are untouched.
pub async fn sync_existing(state: &crate::state::AppState) -> Result<usize> {
    let zotero = state.zotero();
    let collections = zotero.collections().await?;
    for collection in collections { db::upsert_collection(&state.db, &collection, 0)?; }
    let known: BTreeSet<String> = db::active_keys(&state.db)?.into_iter().collect();
    let since = {
        let conn = state.db.lock().map_err(|_| anyhow::anyhow!("数据库锁定失败"))?;
        conn.query_row("SELECT COALESCE(MAX(zotero_version),0) FROM items", [], |row| row.get::<_,i64>(0))?
    };
    let changes = zotero.fetch_all(&format!("/items/top?since={}&includeTrashed=1", since)).await?;
    let mut updated = 0;
    for item in changes {
        let Some(key) = item.get("key").and_then(Value::as_str) else { continue; };
        if !known.contains(key) { continue; }
        let (key,version,title,creators,year,publication,journal_abbreviation,abstract_note,doi,url,item_type,tags,trashed) = metadata(&item)?;
        let id = db::upsert_paper(&state.db,&key,version,&title,&creators,year,&publication,&journal_abbreviation,&abstract_note,&doi,&url,&item_type,&tags,trashed)?;
        let item_keys: Vec<String> = item.get("data").and_then(|d|d.get("collections")).and_then(Value::as_array).map(|a|a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
        db::set_item_collections(&state.db,&id,&item_keys)?;
        updated += 1;
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn recursive_selection_includes_descendants() {
        let all=vec![Collection{key:"a".into(),name:"A".into(),parent_key:None,item_count:0,joined:false},Collection{key:"b".into(),name:"B".into(),parent_key:Some("a".into()),item_count:0,joined:false},Collection{key:"c".into(),name:"C".into(),parent_key:Some("b".into()),item_count:0,joined:false}];
        assert_eq!(ZoteroClient::selected_collections(&all,&["a".into()]).len(),3);
    }

    fn pdf(key:&str)->Attachment{Attachment{key:key.into(),title:format!("PDF {key}"),filename:format!("{key}.pdf")}}
    fn existing_paper(db:&db::SharedDb)->Paper{
        let id=db::upsert_paper(db,"PDFTEST",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        db::replace_attachments(db,&id,&[pdf("PDF-A")]).unwrap();
        db::set_main_pdf(db,&id,Some("PDF-A"),false).unwrap();
        db::set_state(db,&id,"parse_state","succeeded").unwrap();
        db::save_interpretation(db,&id,None,"中文标题","一句话",&[],&[],"test").unwrap();
        db::set_state(db,&id,"read_state","read").unwrap();
        db::get_paper(db,&id).unwrap()
    }

    #[test]
    fn new_alternative_pdf_preserves_main_pdf_and_successful_parse(){
        let db=db::open(Path::new(":memory:")).unwrap();
        let previous=existing_paper(&db);
        let result=sync_pdf(&db,&previous.id,Some(&previous),&[pdf("PDF-A"),pdf("PDF-B")]).unwrap();
        assert_eq!(result,PdfSync::default());
        let paper=db::get_paper(&db,&previous.id).unwrap();
        assert_eq!(paper.main_pdf_key.as_deref(),Some("PDF-A"));
        assert_eq!(paper.parse_state,"succeeded");
        assert_eq!(paper.read_state,"read");
        assert_eq!(paper.title_zh,"中文标题");
        assert_eq!(db::attachments(&db,&paper.id).unwrap().len(),2);
    }

    #[test]
    fn replaced_main_pdf_is_queued(){
        let db=db::open(Path::new(":memory:")).unwrap();
        let previous=existing_paper(&db);
        let result=sync_pdf(&db,&previous.id,Some(&previous),&[pdf("PDF-B")]).unwrap();
        assert_eq!(result,PdfSync{queued:true,choice:false});
        let paper=db::get_paper(&db,&previous.id).unwrap();
        assert_eq!(paper.main_pdf_key.as_deref(),Some("PDF-B"));
        assert_eq!(paper.parse_state,"queued");
        assert!(!paper.needs_pdf_choice);
    }

    #[test]
    fn unchanged_pdf_is_not_queued_again(){
        let db=db::open(Path::new(":memory:")).unwrap();
        let previous=existing_paper(&db);
        let result=sync_pdf(&db,&previous.id,Some(&previous),&[pdf("PDF-A")]).unwrap();
        assert_eq!(result,PdfSync::default());
        assert_eq!(db::get_paper(&db,&previous.id).unwrap().parse_state,"succeeded");
    }

    #[test]
    fn missing_pdf_stays_metadata_only_without_ai_queue(){
        let db=db::open(Path::new(":memory:")).unwrap();
        let id=db::upsert_paper(&db,"NOPDF",1,"Paper",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        db::set_state(&db,&id,"ai_state","queued").unwrap();
        let previous=db::get_paper(&db,&id).unwrap();
        let result=sync_pdf(&db,&id,Some(&previous),&[]).unwrap();
        assert_eq!(result,PdfSync::default());
        let paper=db::get_paper(&db,&id).unwrap();
        assert_eq!(paper.pdf_state,"unavailable");
        assert_eq!(paper.parse_state,"not_started");
        assert_eq!(paper.ai_state,"not_started");
        assert!(paper.error.is_none());
    }

    #[test]
    fn removed_pdf_disables_ai_and_hides_legacy_interpretation(){
        let db=db::open(Path::new(":memory:")).unwrap();
        let previous=existing_paper(&db);
        let result=sync_pdf(&db,&previous.id,Some(&previous),&[]).unwrap();
        assert_eq!(result,PdfSync::default());
        let paper=db::get_paper(&db,&previous.id).unwrap();
        assert_eq!(paper.pdf_state,"unavailable");
        assert_eq!(paper.ai_state,"not_started");
        assert!(db::get_detail(&db,&previous.id).unwrap().interpretation.is_none());
    }

    #[tokio::test]
    async fn file_reads_absolute_attachment_path() {
        let temp=tempfile::tempdir().unwrap();
        let pdf=temp.path().join("linked paper.pdf");
        std::fs::write(&pdf,b"%PDF-path-conversion").unwrap();
        let mut server=mockito::Server::new_async().await;
        let metadata=server.mock("GET","/api/users/0/items/ABCD1234")
            .with_status(200).with_header("content-type","application/json")
            .with_body(json!({"key":"ABCD1234","data":{"itemType":"attachment","contentType":"application/pdf","path":pdf.to_string_lossy(),"filename":"linked paper.pdf"}}).to_string())
            .create_async().await;
        let client=ZoteroClient::new(Client::new(),&format!("{}/api/users/0",server.url()));
        let bytes=client.file("ABCD1234").await.unwrap();
        assert_eq!(bytes,b"%PDF-path-conversion");
        metadata.assert_async().await;
    }

    #[test]
    fn resolves_linked_and_storage_attachment_paths() {
        let temp=tempfile::tempdir().unwrap();
        let root=temp.path();
        let linked=root.join("linked").join("paper.pdf");
        std::fs::create_dir_all(linked.parent().unwrap()).unwrap();
        std::fs::write(&linked,b"%PDF-linked").unwrap();
        assert_eq!(resolve_attachment_path("attachments:linked/paper.pdf",None,"LINKKEY1",Some(root),None),Some(linked));

        let stored=root.join("storage").join("STOREKEY").join("paper.pdf");
        std::fs::create_dir_all(stored.parent().unwrap()).unwrap();
        std::fs::write(&stored,b"%PDF-stored").unwrap();
        assert_eq!(resolve_attachment_path("storage:paper.pdf",Some("paper.pdf"),"STOREKEY",None,Some(root)),Some(stored.clone()));
        assert_eq!(resolve_attachment_path("",Some("paper.pdf"),"STOREKEY",None,Some(&root.join("storage"))),Some(stored));
    }

    #[tokio::test]
    async fn file_falls_back_to_zotero_file_endpoint() {
        let temp=tempfile::tempdir().unwrap();
        let missing=temp.path().join("missing.pdf");
        let mut server=mockito::Server::new_async().await;
        let metadata=server.mock("GET","/api/users/0/items/FALLBACK")
            .with_status(200).with_header("content-type","application/json")
            .with_body(json!({"key":"FALLBACK","data":{"itemType":"attachment","contentType":"application/pdf","path":missing.to_string_lossy(),"filename":""}}).to_string())
            .create_async().await;
        let file=server.mock("GET","/api/users/0/items/FALLBACK/file")
            .with_status(200).with_body("%PDF-api-fallback").create_async().await;
        let client=ZoteroClient::new(Client::new(),&format!("{}/api/users/0",server.url()));
        assert_eq!(client.file("FALLBACK").await.unwrap(),b"%PDF-api-fallback");
        metadata.assert_async().await;
        file.assert_async().await;
    }

    #[tokio::test]
    async fn file_reads_zotero_file_url_redirect() {
        let temp=tempfile::tempdir().unwrap();
        let pdf=temp.path().join("linked 文献.pdf");
        std::fs::write(&pdf,b"%PDF-file-redirect").unwrap();
        let location=url::Url::from_file_path(&pdf).unwrap();
        let mut server=mockito::Server::new_async().await;
        let metadata=server.mock("GET","/api/users/0/items/LINKKEY1")
            .with_status(200).with_header("content-type","application/json")
            .with_body(json!({"key":"LINKKEY1","data":{"itemType":"attachment","contentType":"application/pdf","path":"attachments:linked 文献.pdf","filename":""}}).to_string())
            .create_async().await;
        let file=server.mock("GET","/api/users/0/items/LINKKEY1/file")
            .with_status(302).with_header("location",location.as_str()).create_async().await;
        let http=Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let client=ZoteroClient::new(http,&format!("{}/api/users/0",server.url()));
        assert_eq!(client.file("LINKKEY1").await.unwrap(),b"%PDF-file-redirect");
        metadata.assert_async().await;
        file.assert_async().await;
    }

    #[tokio::test]
    async fn preflight_resolves_file_redirect_before_import(){
        let temp=tempfile::tempdir().unwrap();let pdf=temp.path().join("preflight.pdf");std::fs::write(&pdf,b"%PDF-preflight").unwrap();
        let location=url::Url::from_file_path(&pdf).unwrap();let mut server=mockito::Server::new_async().await;
        let item=json!({"key":"PREFLIGHT","data":{"itemType":"attachment","contentType":"application/pdf","title":"预检文献","path":"N/A","filename":""}});
        let metadata=server.mock("GET","/api/users/0/items/PREFLIGHT").with_status(200).with_header("content-type","application/json").with_body(item.to_string()).create_async().await;
        let file=server.mock("GET","/api/users/0/items/PREFLIGHT/file").match_header("range","bytes=0-4").with_status(302).with_header("location",location.as_str()).create_async().await;
        let http=Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();let client=ZoteroClient::new(http,&format!("{}/api/users/0",server.url()));
        let result=preflight_pdfs(&client,&[item]).await.unwrap();
        assert_eq!(result.with_pdf,1);assert!(result.issues.is_empty());metadata.assert_async().await;file.assert_async().await;
    }

    #[test]
    fn unreadable_attachments_are_skipped_individually(){
        let readable=readable_attachments(vec![pdf("GOOD"),pdf("BROKEN")],&BTreeSet::from(["BROKEN".to_string()]));
        assert_eq!(readable.iter().map(|attachment|attachment.key.as_str()).collect::<Vec<_>>(),vec!["GOOD"]);
    }

    #[tokio::test]
    async fn unreadable_pdf_does_not_block_other_items_from_importing(){
        let temp=tempfile::tempdir().unwrap();
        let good_path=temp.path().join("good.pdf");std::fs::write(&good_path,b"%PDF-good").unwrap();
        let missing_path=temp.path().join("missing.pdf");
        let mut server=mockito::Server::new_async().await;
        let collection=json!({"key":"C","data":{"name":"Collection","parentCollection":false}});
        let bad=json!({"key":"BAD","version":1,"data":{"title":"Broken PDF","itemType":"journalArticle","collections":["C"],"creators":[],"tags":[]}});
        let good=json!({"key":"GOOD","version":1,"data":{"title":"Readable PDF","itemType":"journalArticle","collections":["C"],"creators":[],"tags":[]}});
        let bad_attachment=json!({"key":"BADPDF","data":{"itemType":"attachment","contentType":"application/pdf","title":"Broken","filename":""}});
        let good_attachment=json!({"key":"GOODPDF","data":{"itemType":"attachment","contentType":"application/pdf","title":"Readable","filename":"good.pdf"}});
        let collections=server.mock("GET","/api/users/0/collections").match_query(mockito::Matcher::Any).with_status(200).with_header("content-type","application/json").with_body(json!([collection]).to_string()).create_async().await;
        let top=server.mock("GET","/api/users/0/collections/C/items/top").match_query(mockito::Matcher::Any).with_status(200).with_header("content-type","application/json").with_body(json!([bad.clone(),good.clone()]).to_string()).create_async().await;
        let bad_children=server.mock("GET","/api/users/0/items/BAD/children").match_query(mockito::Matcher::Any).with_status(200).with_header("content-type","application/json").with_body(json!([bad_attachment.clone()]).to_string()).expect(2).create_async().await;
        let good_children=server.mock("GET","/api/users/0/items/GOOD/children").match_query(mockito::Matcher::Any).with_status(200).with_header("content-type","application/json").with_body(json!([good_attachment.clone()]).to_string()).expect(2).create_async().await;
        let bad_metadata=server.mock("GET","/api/users/0/items/BADPDF").with_status(200).with_header("content-type","application/json").with_body(json!({"key":"BADPDF","data":{"itemType":"attachment","contentType":"application/pdf","path":missing_path.to_string_lossy(),"filename":""}}).to_string()).create_async().await;
        let bad_file=server.mock("GET","/api/users/0/items/BADPDF/file").match_header("range","bytes=0-4").with_status(404).create_async().await;
        let good_metadata=server.mock("GET","/api/users/0/items/GOODPDF").with_status(200).with_header("content-type","application/json").with_body(json!({"key":"GOODPDF","data":{"itemType":"attachment","contentType":"application/pdf","path":good_path.to_string_lossy(),"filename":"good.pdf"}}).to_string()).create_async().await;
        let db=db::open(Path::new(":memory:")).unwrap();
        let state=crate::state::AppState{db:db.clone(),data_dir:temp.path().to_path_buf(),http:Client::new(),zotero_base:format!("{}/api/users/0",server.url()),jobs:std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()))};
        let (result,choices)=import_collections(&state,&["C".to_string()]).await.unwrap();
        assert_eq!((result.imported,result.queued,result.skipped),(2,1,0));assert!(choices.is_empty());
        let broken=db::paper_by_zotero_key(&db,"BAD").unwrap().unwrap();
        assert_eq!(broken.pdf_state,"unavailable");assert_eq!(broken.ai_state,"not_started");
        let readable=db::paper_by_zotero_key(&db,"GOOD").unwrap().unwrap();
        assert_eq!(readable.pdf_state,"available");assert_eq!(readable.parse_state,"queued");
        collections.assert_async().await;top.assert_async().await;bad_children.assert_async().await;good_children.assert_async().await;bad_metadata.assert_async().await;bad_file.assert_async().await;good_metadata.assert_async().await;
    }

    #[tokio::test]
    async fn file_rejects_network_redirects() {
        let mut server=mockito::Server::new_async().await;
        let metadata=server.mock("GET","/api/users/0/items/REMOTE01")
            .with_status(200).with_header("content-type","application/json")
            .with_body(json!({"key":"REMOTE01","data":{"itemType":"attachment","contentType":"application/pdf","path":"N/A","filename":""}}).to_string())
            .create_async().await;
        let file=server.mock("GET","/api/users/0/items/REMOTE01/file")
            .with_status(302).with_header("location","https://example.com/private.pdf").create_async().await;
        let http=Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let client=ZoteroClient::new(http,&format!("{}/api/users/0",server.url()));
        let error=client.file("REMOTE01").await.unwrap_err().to_string();
        assert!(error.contains("仅允许读取本机 file:// PDF"));
        metadata.assert_async().await;
        file.assert_async().await;
    }
}
