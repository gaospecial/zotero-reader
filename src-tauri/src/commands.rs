use crate::{archive,backup,credentials::{self,ApiService},db,deepseek,models::*,pipeline,state::AppState,zotero::ZoteroClient};
use base64::{engine::general_purpose::STANDARD,Engine};
use std::{sync::Arc,time::Duration};
use tauri::{AppHandle,Emitter,State};

type CmdResult<T>=Result<T,String>;
fn err(error:impl std::fmt::Display)->String{error.to_string()}

#[tauri::command]
pub async fn get_bootstrap(state:State<'_,Arc<AppState>>)->CmdResult<Bootstrap>{
    let connected=state.zotero().check().await.is_ok();
    Ok(Bootstrap{papers:db::list_papers(&state.db,LibraryQuery{search:None,collection:None,status:None,view:None,sort:None}).map_err(err)?,collections:db::list_collections(&state.db).map_err(err)?,stats:db::stats(&state.db).map_err(err)?,services:ServiceStatus{zotero_connected:connected,deepseek_configured:credentials::is_configured(ApiService::Deepseek),doc2x_configured:credentials::is_configured(ApiService::Doc2x),demo_mode:false}})
}

#[tauri::command]pub async fn connect_zotero(state:State<'_,Arc<AppState>>)->CmdResult<bool>{state.zotero().check().await.map_err(err)?;crate::zotero::sync_existing(&state).await.map_err(err)?;Ok(true)}
#[tauri::command]pub fn list_library(state:State<'_,Arc<AppState>>,query:LibraryQuery)->CmdResult<Vec<Paper>>{db::list_papers(&state.db,query).map_err(err)}
#[tauri::command]pub fn get_paper_detail(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<PaperDetail>{db::get_detail(&state.db,&item_id).map_err(err)}
#[tauri::command]pub fn list_notes(state:State<'_,Arc<AppState>>,search:Option<String>)->CmdResult<Vec<Note>>{db::list_notes(&state.db,search.as_deref()).map_err(err)}
#[tauri::command]pub fn save_note(state:State<'_,Arc<AppState>>,item_id:String,content:String)->CmdResult<()>{db::save_note(&state.db,&item_id,&content).map_err(err)}
#[tauri::command]pub fn list_item_notes(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<Vec<Note>>{db::list_item_notes(&state.db,&item_id).map_err(err)}
#[tauri::command]pub fn create_anchored_note(state:State<'_,Arc<AppState>>,item_id:String,interpretation_id:String,content:String,locator:NoteLocator)->CmdResult<String>{db::create_anchored_note(&state.db,&item_id,&interpretation_id,&content,&locator).map_err(err)}
#[tauri::command]pub fn update_anchored_note(state:State<'_,Arc<AppState>>,note_id:String,content:String,locator:NoteLocator)->CmdResult<()>{db::update_anchored_note(&state.db,&note_id,&content,&locator).map_err(err)}
#[tauri::command]pub fn delete_anchored_note(state:State<'_,Arc<AppState>>,note_id:String)->CmdResult<()>{db::delete_anchored_note(&state.db,&note_id).map_err(err)}
#[tauri::command]pub fn list_qa(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<Vec<QaMessage>>{db::list_qa(&state.db,&item_id).map_err(err)}
#[tauri::command]pub fn clear_qa(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<()>{db::clear_qa(&state.db,&item_id).map_err(err)}

#[tauri::command]
pub async fn preview_import(state:State<'_,Arc<AppState>>,collection_keys:Vec<String>)->CmdResult<ImportPreview>{
    let zotero=state.zotero();let all=zotero.collections().await.map_err(err)?;let keys=ZoteroClient::selected_collections(&all,&collection_keys);
    if keys.is_empty(){return Err("请至少选择一个分类".into());}
    let items=zotero.top_items(&keys).await.map_err(err)?;
    let preflight=crate::zotero::preflight_pdfs(&zotero,&items).await.map_err(err)?;
    Ok(ImportPreview{collection_keys:keys.iter().cloned().collect(),collection_names:all.iter().filter(|c|keys.contains(&c.key)).map(|c|c.name.clone()).collect(),total:items.len(),with_pdf:preflight.with_pdf,without_pdf:items.len()-preflight.with_pdf,multiple_pdf:preflight.multiple_pdf,pdf_issues:preflight.issues})
}

#[tauri::command]
pub async fn get_collection_overviews(state:State<'_,Arc<AppState>>)->CmdResult<Vec<CollectionOverview>>{
    state.zotero().collection_overviews().await.map_err(err)
}

async fn import_and_queue(state:&Arc<AppState>,app:&AppHandle,collection_keys:&[String])->CmdResult<ImportResult>{
    let _guard=state.collection_sync.lock().await;
    let (result,_)=crate::zotero::import_collections(state,collection_keys).await.map_err(err)?;
    let papers=db::list_papers(&state.db,LibraryQuery{search:None,collection:None,status:None,view:None,sort:None}).map_err(err)?;
    for paper in papers.into_iter().filter(|p|p.pdf_state=="available"&&(p.parse_state=="queued"||p.ai_state=="queued")){pipeline::spawn(state.clone(),app.clone(),paper.id);}
    Ok(result)
}

#[tauri::command]
pub async fn import_collections(state:State<'_,Arc<AppState>>,app:AppHandle,collection_keys:Vec<String>)->CmdResult<ImportResult>{
    import_and_queue(state.inner(),&app,&collection_keys).await
}

#[tauri::command]
pub async fn sync_collection(state:State<'_,Arc<AppState>>,app:AppHandle,collection_key:String)->CmdResult<ImportResult>{
    import_and_queue(state.inner(),&app,&[collection_key]).await
}

pub async fn auto_sync_joined(state:Arc<AppState>,app:AppHandle){
    if state.zotero().check().await.is_err(){return;}
    if let Err(error)=crate::zotero::sync_existing(&state).await{eprintln!("同步 Zotero 分类失败：{error}");return;}
    let joined=match db::list_collections(&state.db){Ok(collections)=>collections.into_iter().filter(|collection|collection.joined).map(|collection|collection.key).collect::<Vec<_>>(),Err(_)=>return};
    let refresh_collections=||{let _=app.emit("library-synced",ImportResult{imported:0,queued:0,skipped:0});};
    if joined.is_empty(){refresh_collections();return;}
    match import_and_queue(&state,&app,&joined).await{
        Ok(result)=>{let _=app.emit("library-synced",result);},
        Err(error)=>{eprintln!("自动同步 Zotero 分类失败：{error}");refresh_collections();},
    }
}

#[tauri::command]pub fn list_pdf_choices(state:State<'_,Arc<AppState>>)->CmdResult<Vec<PdfChoice>>{
    let papers=db::list_papers(&state.db,LibraryQuery{search:None,collection:None,status:None,view:None,sort:None}).map_err(err)?;
    papers.into_iter().filter(|p|p.needs_pdf_choice).map(|p|Ok(PdfChoice{item_id:p.id.clone(),attachments:db::attachments(&state.db,&p.id).map_err(err)?})).collect()
}

#[tauri::command]pub async fn choose_main_pdf(state:State<'_,Arc<AppState>>,app:AppHandle,item_id:String,pdf_key:String)->CmdResult<()>{db::set_main_pdf(&state.db,&item_id,Some(&pdf_key),false).map_err(err)?;db::set_error(&state.db,&item_id,None).map_err(err)?;db::set_state(&state.db,&item_id,"parse_state","queued").map_err(err)?;pipeline::spawn(state.inner().clone(),app,item_id);Ok(())}
#[tauri::command]pub async fn retry_item(state:State<'_,Arc<AppState>>,app:AppHandle,item_id:String)->CmdResult<()>{db::set_error(&state.db,&item_id,None).map_err(err)?;pipeline::spawn(state.inner().clone(),app,item_id);Ok(())}
#[tauri::command]pub async fn regenerate_item(state:State<'_,Arc<AppState>>,app:AppHandle,item_id:String)->CmdResult<()>{let shared=state.inner().clone();tauri::async_runtime::spawn(async move{if let Err(error)=pipeline::regenerate(shared.clone(),app.clone(),item_id.clone()).await{let _=db::set_state(&shared.db,&item_id,"ai_state","failed");let _=db::set_error(&shared.db,&item_id,Some(&error.to_string()));}});Ok(())}
#[tauri::command]pub async fn cancel_item(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<()>{if let Some(token)=state.jobs.lock().await.get(&item_id){token.cancel();}Ok(())}

#[tauri::command]
pub async fn ask_question(state:State<'_,Arc<AppState>>,app:AppHandle,item_id:String,question:String)->CmdResult<()>{
    if question.trim().is_empty(){return Err("请输入问题".into());}
    let paper=db::get_paper(&state.db,&item_id).map_err(err)?;let shared=state.inner().clone();
    deepseek::ask(shared,app,paper,question).await.map_err(err)
}

#[tauri::command]pub fn set_read_state(state:State<'_,Arc<AppState>>,item_id:String,read_state:String)->CmdResult<()>{if !["unread","reading","read"].contains(&read_state.as_str()){return Err("无效阅读状态".into());}db::set_state(&state.db,&item_id,"read_state",&read_state).map_err(err)}
#[tauri::command]pub fn trash_item(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<()>{db::trash_item(&state.db,&item_id).map_err(err)}
#[tauri::command]pub fn restore_item(state:State<'_,Arc<AppState>>,item_id:String)->CmdResult<()>{db::restore_item(&state.db,&item_id).map_err(err)}

#[tauri::command]
pub async fn sync_trash_to_zotero(state:State<'_,Arc<AppState>>)->CmdResult<usize>{
    let papers=db::pending_trash(&state.db).map_err(err)?;if papers.is_empty(){return Ok(0);}let zotero=state.zotero();let server_id=zotero.server_id().await.map_err(err)?;
    let account=format!("zotero-write-{}",server_id);let entry=keyring::Entry::new("com.zoteroreader.desktop",&account).map_err(err)?;
    let mut key=entry.get_password().ok();
    if key.is_none(){let(auth,remember)=zotero.authorize(&server_id).await.map_err(err)?;if papers.len()>1&&!remember{return Err("批量同步需要在 Zotero 授权窗口选择“始终允许”".into());}if remember{entry.set_password(&auth).map_err(err)?;}key=Some(auth);}
    let mut completed=0;for paper in papers{match zotero.move_to_trash(&paper,&server_id,key.as_deref().unwrap_or_default()).await{Ok(())=>{db::mark_zotero_trashed(&state.db,&paper.id).map_err(err)?;completed+=1;},Err(error)=>{let _=entry.delete_credential();return Err(format!("已同步 {} 篇，随后失败：{}",completed,error));}}}Ok(completed)
}

#[tauri::command]
pub async fn sync_zotero(state:State<'_,Arc<AppState>>)->CmdResult<usize>{
    crate::zotero::sync_existing(&state).await.map_err(err)
}

#[tauri::command]pub fn get_asset(state:State<'_,Arc<AppState>>,item_id:String,version_id:String,path:String)->CmdResult<String>{let(mime,bytes)=archive::read_asset(&state.data_dir,&item_id,&version_id,&path).map_err(err)?;Ok(format!("data:{};base64,{}",mime,STANDARD.encode(bytes)))}
#[tauri::command]pub fn get_source_excerpt(state:State<'_,Arc<AppState>>,item_id:String,version_id:String,heading:String)->CmdResult<String>{
    let dir=state.data_dir.join("files").join(&item_id).join(&version_id);
    let(_,markdown)=archive::read_main_markdown(&dir).map_err(err)?;
    let mut found=false;let mut excerpt=Vec::new();
    for line in markdown.lines(){
        let is_heading=line.starts_with('#');
        if is_heading {let title=line.trim_start_matches('#').trim();if found{break;}if title==heading||title.contains(&heading)||heading.contains(title){found=true;}}
        if found{excerpt.push(line);}
    }
    if !found{return Err(format!("当前 Markdown 版本中没有找到“{}”章节",heading));}
    Ok(excerpt.join("\n").chars().take(6000).collect())
}
#[tauri::command]pub fn export_backup(state:State<'_,Arc<AppState>>,path:String)->CmdResult<()>{backup::export(&state,std::path::Path::new(&path)).map_err(err)}
#[tauri::command]pub fn restore_backup(state:State<'_,Arc<AppState>>,path:String)->CmdResult<()>{backup::restore(&state,std::path::Path::new(&path)).map_err(err)}
#[tauri::command]pub async fn open_zotero_pdf(item_key:String)->CmdResult<()>{tauri_plugin_opener::open_url(format!("zotero://select/library/items/{}",item_key),None::<&str>).map_err(err)}
#[tauri::command]pub fn open_config_file()->CmdResult<String>{let path=crate::config::path().ok_or("应用配置尚未初始化")?;tauri_plugin_opener::open_path(&path,None::<&str>).map_err(err)?;Ok(path.to_string_lossy().to_string())}
#[tauri::command]pub fn service_configuration(state:State<'_,Arc<AppState>>)->ServiceConfiguration{ServiceConfiguration{zotero_base_url:state.zotero_base.clone(),deepseek_api_key:credentials::get(ApiService::Deepseek).unwrap_or_default(),doc2x_api_key:credentials::get(ApiService::Doc2x).unwrap_or_default()}}
#[tauri::command]pub fn get_literature_prompt()->String{crate::config::literature_prompt()}
#[tauri::command]pub fn set_literature_prompt(prompt:String)->CmdResult<String>{crate::config::set_literature_prompt(&prompt).map_err(err)}
#[tauri::command]pub fn reset_literature_prompt()->CmdResult<String>{crate::config::reset_literature_prompt().map_err(err)}
#[tauri::command]pub fn set_api_key(service:String,key:String)->CmdResult<()>{let service=ApiService::parse(&service).ok_or("不支持的 API 服务")?;credentials::set(service,&key).map_err(err)}
#[tauri::command]pub async fn startup_sync(state:State<'_,Arc<AppState>>)->CmdResult<()>{match tokio::time::timeout(Duration::from_secs(3),state.zotero().check()).await{Ok(Ok(()))=>Ok(()),Ok(Err(error))=>Err(err(error)),Err(_)=>Err("连接 Zotero 超时".into())}}
