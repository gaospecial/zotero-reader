use crate::{archive,db,deepseek,doc2x,models::ProgressEvent,state::AppState};
use anyhow::Result;
use std::{sync::Arc,time::Duration};
use tauri::{AppHandle,Emitter};
use tokio_util::sync::CancellationToken;

fn progress(app:&AppHandle,item_id:&str,stage:&str,message:&str){let _=app.emit("paper-progress",ProgressEvent{item_id:item_id.into(),stage:stage.into(),message:message.into()});}

pub fn spawn(state:Arc<AppState>,app:AppHandle,item_id:String){
    tauri::async_runtime::spawn(async move{
        let token=CancellationToken::new();state.jobs.lock().await.insert(item_id.clone(),token.clone());
        if let Err(error)=process(state.clone(),app.clone(),item_id.clone(),token).await{
            let message=format!("{error:#}");
            let _=db::set_error(&state.db,&item_id,Some(&message));
            let paper=db::get_paper(&state.db,&item_id).ok();
            if let Some(paper)=paper{if paper.pdf_state=="available"&&paper.parse_state!="succeeded"{let _=db::set_state(&state.db,&item_id,"parse_state","failed");}else{let _=db::set_state(&state.db,&item_id,"ai_state","failed");}}
            progress(&app,&item_id,"failed",&message);
        }
        state.jobs.lock().await.remove(&item_id);
    });
}

async fn process(state:Arc<AppState>,app:AppHandle,item_id:String,token:CancellationToken)->Result<()>{
    let mut paper=db::get_paper(&state.db,&item_id)?;
    if paper.needs_pdf_choice{return Ok(());}
    if paper.pdf_state!="available"{
        db::set_state(&state.db,&item_id,"ai_state","not_started")?;
        db::set_error(&state.db,&item_id,None)?;
        progress(&app,&item_id,"metadata","缺少全文，仅显示 Zotero 元信息");
        return Ok(());
    }
    let mut markdown=None;let mut figures=Vec::new();
    if paper.parse_state!="succeeded"{
        let pdf_key=paper.main_pdf_key.clone().ok_or_else(||anyhow::anyhow!("未设置主 PDF"))?;
        let mut last_error=None;
        for attempt in 0..3{
            if token.is_cancelled(){db::set_state(&state.db,&item_id,"parse_state","not_started")?;return Ok(());}
            db::set_state(&state.db,&item_id,"parse_state",if attempt==0{"processing"}else{"retry_wait"})?;
            progress(&app,&item_id,"parsing",if attempt==0{"正在解析论文"}else{"正在重试解析"});
            let version_id=uuid::Uuid::new_v4().to_string();
            match doc2x::parse_pdf(&state,&item_id,&pdf_key,&version_id).await{
                Ok((_dir,text,sha))=>{
                    db::save_markdown(&state.db,&item_id,&version_id,&sha)?;
                    db::set_state(&state.db,&item_id,"parse_state","succeeded")?;db::set_error(&state.db,&item_id,None)?;
                    figures=archive::figures_from_markdown(&text);markdown=Some((version_id,text));last_error=None;break;
                },Err(error)=>{last_error=Some(error);if attempt<2{tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;}}
            }
        }
        if let Some(error)=last_error{return Err(error);}
    }else if let Some((id,path))=db::latest_markdown(&state.db,&item_id)?{
        let dir=state.data_dir.join("files").join(&item_id).join(&path);let(_,text)=archive::read_main_markdown(&dir)?;figures=archive::figures_from_markdown(&text);markdown=Some((id,text));
    }
    if token.is_cancelled(){return Ok(());}
    let Some((version_id,text))=markdown.as_ref()else{anyhow::bail!("缺少已解析全文，未调用 AI 解读");};
    db::set_state(&state.db,&item_id,"ai_state","queued")?;progress(&app,&item_id,"thinking","正在生成中文解读");
    paper=db::get_paper(&state.db,&item_id)?;db::set_state(&state.db,&item_id,"ai_state",if figures.is_empty(){"generating"}else{"vision_wait"})?;
    let result=deepseek::generate(&state,&paper,(version_id,text),&figures).await?;
    db::save_interpretation(&state.db,&item_id,result.markdown_version_id.as_deref(),&result.title_zh,&result.one_sentence,&result.sections,&figures,&result.model)?;
    progress(&app,&item_id,"done","解读已生成");Ok(())
}

pub async fn regenerate(state:Arc<AppState>,app:AppHandle,item_id:String)->Result<()>{
    let paper=db::get_paper(&state.db,&item_id)?;
    if paper.pdf_state!="available"{anyhow::bail!("该条目缺少全文，仅显示 Zotero 元信息");}
    let (id,path)=db::latest_markdown(&state.db,&item_id)?.ok_or_else(||anyhow::anyhow!("缺少已解析全文，未调用 AI 解读"))?;
    let dir=state.data_dir.join("files").join(&item_id).join(&path);let(_,text)=archive::read_main_markdown(&dir)?;let figures=archive::figures_from_markdown(&text);
    db::set_state(&state.db,&item_id,"ai_state","generating")?;
    let result=deepseek::generate(&state,&paper,(&id,&text),&figures).await?;
    db::save_interpretation(&state.db,&item_id,Some(&id),&result.title_zh,&result.one_sentence,&result.sections,&figures,&result.model)?;
    progress(&app,&item_id,"done","解读已更新");Ok(())
}
