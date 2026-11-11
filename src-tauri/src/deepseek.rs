use crate::{archive,credentials::{self,ApiService},db,models::*,state::AppState};
use anyhow::{Context,Result};
use base64::{engine::general_purpose::STANDARD,Engine};
use futures_util::StreamExt;
use serde_json::{json,Value};
use std::sync::Arc;
use tauri::{AppHandle,Emitter};

pub const DEFAULT_PROMPT:&str=include_str!("../../prompts/literature_interpretation.txt");

fn key()->Result<String>{credentials::get(ApiService::Deepseek)}
pub fn model()->String{crate::environment::get("DEEPSEEK_MODEL").unwrap_or_else(||"deepseek-v4-flash-vision-exp".into())}
fn endpoint()->String{crate::environment::get("DEEPSEEK_BASE_URL").unwrap_or_else(||"https://api.deepseek.com".into()).trim_end_matches('/').to_string()+"/chat/completions"}

fn image_content(state:&AppState,item_id:&str,version_id:&str,figures:&[Figure])->Vec<Value>{
    figures.iter().take(4).filter_map(|figure|{
        archive::read_asset(&state.data_dir,item_id,version_id,&figure.path).ok().map(|(mime,bytes)|json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",mime,STANDARD.encode(bytes))}}))
    }).collect()
}

#[derive(Debug,serde::Deserialize)]#[serde(rename_all="camelCase")]
struct AiOutput{#[serde(default,alias="title_zh")]title_zh:String,#[serde(default,alias="one_sentence")]one_sentence:String,sections:Vec<Section>}

#[derive(Debug,serde::Deserialize)]#[serde(rename_all="camelCase")]
struct MetadataOutput{#[serde(default)]title_zh:String,#[serde(default)]one_sentence:String}

fn cleaned_json(text:&str)->&str{
    text.trim().strip_prefix("```json").or_else(||text.trim().strip_prefix("```")).unwrap_or(text.trim()).trim_end_matches("```").trim()
}

fn decode_output(text:&str)->Result<AiOutput>{
    serde_json::from_str(cleaned_json(text)).map_err(|error|anyhow::anyhow!("DeepSeek 返回的解读不是约定的 JSON 结构：{}",error))
}

async fn complete_metadata(state:&AppState,paper:&Paper,output:&mut AiOutput)->Result<()>{
    if !output.title_zh.trim().is_empty()&&!output.one_sentence.trim().is_empty(){return Ok(());}
    let prompt=format!("请根据以下文献题录，补全文献解读的展示信息。只返回合法 JSON：{{\"titleZh\":\"准确自然的中文标题\",\"oneSentence\":\"不超过 80 字的一句话核心结论\"}}。\n\n英文标题：{}\n作者：{}\n期刊：{}\n摘要：{}",paper.title,paper.creators.join("、"),paper.publication,paper.abstract_note);
    let body=json!({"model":model(),"messages":[{"role":"user","content":prompt}],"response_format":{"type":"json_object"},"temperature":0.2,"max_tokens":3000,"stream":false});
    let response=state.http.post(endpoint()).bearer_auth(key()?).json(&body).send().await?;
    let status=response.status();let value:Value=response.json().await?;
    if !status.is_success(){anyhow::bail!("DeepSeek 补全展示信息失败（{}）",status);}
    let text=value.pointer("/choices/0/message/content").and_then(Value::as_str).context("DeepSeek 未返回展示信息")?;
    let metadata:MetadataOutput=serde_json::from_str(cleaned_json(text)).context("DeepSeek 补全展示信息的 JSON 结构不正确")?;
    if output.title_zh.trim().is_empty(){output.title_zh=metadata.title_zh;}
    if output.one_sentence.trim().is_empty(){output.one_sentence=metadata.one_sentence;}
    if output.title_zh.trim().is_empty()||output.one_sentence.trim().is_empty(){anyhow::bail!("DeepSeek 未能补全中文标题或一句话摘要");}
    Ok(())
}

pub async fn generate(state:&AppState,paper:&Paper,markdown:(&str,&str),figures:&[Figure])->Result<Interpretation>{
    let (version_id,source)=markdown;
    let source=if source.chars().count()>700_000{source.chars().take(700_000).collect::<String>()}else{source.to_string()};
    let prompt=crate::config::get(crate::config::LITERATURE_PROMPT).unwrap_or_else(||DEFAULT_PROMPT.to_string());
    let system=format!("{}\n\n你必须只返回合法 JSON，不要 Markdown 代码围栏。结构：{{\"title_zh\":\"准确自然的中文标题\",\"one_sentence\":\"不超过 80 字的一句话核心结论\",\"sections\":[{{\"title\":\"基本信息提取\",\"content\":\"支持 Markdown 的详细中文内容\",\"source\":\"原文中对应章节的准确标题\"}}]}}。每个 section 的 source 必须来自原文标题，不得虚构。sections 必须严格包含七段：基本信息提取、研究背景与目的、研究方法、主要发现与结果、讨论与结论、创新点与贡献、个人评价与启示。",prompt);
    let metadata=format!("英文标题：{}\n作者：{}\n年份：{}\n期刊：{}\nDOI：{}",paper.title,paper.creators.join("、"),paper.year.map(|y|y.to_string()).unwrap_or_else(||"未知".into()),paper.publication,paper.doi);
    let mut content=vec![json!({"type":"text","text":format!("{}\n\n文献原文：\n{}",metadata,source)})];
    content.extend(image_content(state,&paper.id,version_id,figures));
    let body=json!({"model":model(),"messages":[{"role":"system","content":system},{"role":"user","content":content}],"response_format":{"type":"json_object"},"temperature":0.2,"max_tokens":12000,"stream":false});
    let response=state.http.post(endpoint()).bearer_auth(key()?).json(&body).send().await?;
    let status=response.status();let value:Value=response.json().await?;
    if !status.is_success(){anyhow::bail!("DeepSeek {}：{}",status,value.get("error").and_then(|e|e.get("message")).and_then(Value::as_str).unwrap_or("请求失败"));}
    let text=value.pointer("/choices/0/message/content").and_then(Value::as_str).context("DeepSeek 未返回解读内容")?;
    let mut output=decode_output(text)?;
    if output.sections.len()!=7{anyhow::bail!("DeepSeek 未返回完整七段解读");}
    complete_metadata(state,paper,&mut output).await?;
    Ok(Interpretation{id:uuid::Uuid::new_v4().to_string(),item_id:paper.id.clone(),markdown_version_id:Some(version_id.to_string()),title_zh:output.title_zh,one_sentence:output.one_sentence,sections:output.sections,figures:figures.to_vec(),model:model(),created_at:chrono::Utc::now().to_rfc3339()})
}

fn headings(markdown:&str)->Vec<String>{markdown.lines().filter_map(|l|l.strip_prefix('#').map(|h|h.trim_start_matches('#').trim().to_string())).filter(|h|!h.is_empty()).take(30).collect()}

pub async fn ask<R:tauri::Runtime>(state:Arc<AppState>,app:AppHandle<R>,paper:Paper,question:String)->Result<()>{
    let event_id=uuid::Uuid::new_v4().to_string();
    let emit=|kind:&str,text:Option<String>,sources:Option<Vec<String>>,visual_refs:Option<Vec<String>>,usage:Option<Value>|{
        let _=app.emit("qa-event",QaEvent{item_id:paper.id.clone(),message_id:event_id.clone(),kind:kind.into(),text,sources,visual_refs,usage});
    };
    if paper.pdf_state!="available"{anyhow::bail!("该条目缺少全文，仅显示 Zotero 元信息");}
    let (id,path)=db::latest_markdown(&state.db,&paper.id)?.ok_or_else(||anyhow::anyhow!("缺少已解析全文，无法调用 AI 问答"))?;
    let dir=state.data_dir.join("files").join(&paper.id).join(&path);let(_,markdown)=archive::read_main_markdown(&dir)?;
    if markdown.trim().is_empty(){anyhow::bail!("已解析全文为空，无法调用 AI 问答");}
    let version_id=id;
    db::add_qa(&state.db,&paper.id,"user",&question,&[],&[],false,None)?;
    let detail=db::get_detail(&state.db,&paper.id)?;let figures=detail.interpretation.as_ref().map(|i|i.figures.clone()).unwrap_or_default();
    let wants_vision=["图","表","figure","table","image","chart"].iter().any(|k|question.to_lowercase().contains(k));
    let visual:Vec<String>=if wants_vision{figures.iter().take(4).map(|f|f.path.clone()).collect()}else{Vec::new()};
    let sources=headings(&markdown);emit("source",None,Some(sources.clone()),None,None);
    if !visual.is_empty(){emit("visual",None,None,Some(visual.clone()),None);}
    let history=db::list_qa(&state.db,&paper.id)?;
    let mut messages=vec![json!({"role":"system","content":"你是单篇论文问答助手。只能使用当前文献原文，不使用用户笔记或外部知识作答。回答使用中文并引用 Markdown 章节名，例如【来源：研究方法】。内容不存在时直接回答“文献未提及”，不得编造。任何超出原文的推断必须以【模型推断】开头。需要视觉信息时结合给定论文图片。"})];
    for message in history{messages.push(json!({"role":message.role,"content":message.content}));}
    let mut user_content=vec![json!({"type":"text","text":format!("以下是当前文献 Markdown 原文，仅作为本次回答依据：\n\n{}",markdown)})];
    if wants_vision{user_content.extend(image_content(&state,&paper.id,&version_id,&figures));}
    messages.push(json!({"role":"user","content":user_content}));
    let body=json!({"model":model(),"messages":messages,"temperature":0.2,"max_tokens":8000,"stream":true,"stream_options":{"include_usage":true}});
    let response=state.http.post(endpoint()).bearer_auth(key()?).json(&body).send().await?;
    if !response.status().is_success(){let status=response.status();let text=response.text().await.unwrap_or_default();anyhow::bail!("DeepSeek {}：{}",status,text);}
    let mut stream=response.bytes_stream();let mut buffer=String::new();let mut answer=String::new();let mut usage=None;
    while let Some(chunk)=stream.next().await{
        buffer.push_str(&String::from_utf8_lossy(&chunk?));
        while let Some(pos)=buffer.find('\n'){
            let line=buffer[..pos].trim().to_string();buffer.drain(..=pos);
            let Some(data)=line.strip_prefix("data:").map(str::trim)else{continue};
            if data=="[DONE]"{continue;}
            let Ok(value)=serde_json::from_str::<Value>(data)else{continue};
            if let Some(delta)=value.pointer("/choices/0/delta/content").and_then(Value::as_str){answer.push_str(delta);emit("delta",Some(delta.into()),None,None,None);}
            if value.get("usage").is_some(){usage=value.get("usage").cloned();}
        }
    }
    if answer.trim().is_empty(){anyhow::bail!("DeepSeek 本次未生成回答。模型可能已将输出额度用于推理，请重试。");}
    let inference=answer.contains("【模型推断】")||answer.contains("模型推断");
    if inference{emit("inference",None,None,None,None);}
    db::add_qa(&state.db,&paper.id,"assistant",&answer,&sources,&visual,inference,usage.as_ref())?;
    if usage.is_some(){emit("usage",None,None,None,usage);}
    emit("done",None,None,None,None);Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    static ENV_LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());

    #[test]
    fn accepts_missing_display_metadata_without_losing_sections(){
        let output=decode_output(r#"{"sections":[{"title":"基本信息提取","content":"内容","source":"Introduction"}]}"#).unwrap();
        assert!(output.title_zh.is_empty());
        assert!(output.one_sentence.is_empty());
        assert_eq!(output.sections.len(),1);
        assert_eq!(output.sections[0].content,"内容");
    }

    #[test]
    fn accepts_snake_case_display_metadata_from_the_documented_prompt(){
        let output=decode_output(r#"{"title_zh":"中文标题","one_sentence":"核心结论","sections":[]}"#).unwrap();
        assert_eq!(output.title_zh,"中文标题");
        assert_eq!(output.one_sentence,"核心结论");
    }

    #[tokio::test]
    async fn streams_reject_empty_answers_and_emit_normal_answers(){
        let _guard=ENV_LOCK.lock().unwrap();
        let mut server=mockito::Server::new_async().await;
        let completion=server.mock("POST","/chat/completions").with_status(200).with_header("content-type","text/event-stream")
            .with_body(concat!(
                "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"仍在推理\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}],\"usage\":{\"total_tokens\":3000,\"completion_tokens_details\":{\"reasoning_tokens\":3000}}}\n\n",
                "data: [DONE]\n\n"
            )).create_async().await;
        std::env::set_var("DEEPSEEK_API_KEY","test-key");
        std::env::set_var("DEEPSEEK_BASE_URL",server.url());
        std::env::set_var("DEEPSEEK_MODEL","deepseek-flash");
        let temp=tempfile::tempdir().unwrap();
        let db=db::open(std::path::Path::new(":memory:")).unwrap();
        let item_id=db::upsert_paper(&db,"QAEMPTY",1,"Reasoning test",&[],None,"","","","","","journalArticle",&[],false).unwrap();
        db::set_state(&db,&item_id,"pdf_state","available").unwrap();
        db::save_markdown(&db,&item_id,"version","sha").unwrap();
        let version_dir=temp.path().join("files").join(&item_id).join("version");
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::write(version_dir.join("full.md"),"# 研究方法\n随机对照实验。").unwrap();
        let paper=db::get_paper(&db,&item_id).unwrap();
        let state=Arc::new(AppState{db:db.clone(),data_dir:temp.path().to_path_buf(),http:reqwest::Client::new(),zotero_base:String::new(),jobs:Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),collection_sync:Arc::new(tokio::sync::Mutex::new(()))});
        let app=tauri::test::mock_app();
        let result=ask(state.clone(),app.handle().clone(),paper,"研究方法是什么？".into()).await;
        let error=result.expect_err("只有推理而没有正文时不能保存空答案").to_string();
        assert!(error.contains("未生成回答"));
        assert!(db::list_qa(&db,&item_id).unwrap().iter().all(|message|message.role!="assistant"));
        completion.assert_async().await;
        completion.remove_async().await;

        let normal=server.mock("POST","/chat/completions").with_status(200).with_header("content-type","text/event-stream")
            .with_body(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"正常回答\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":20}}\n\n",
                "data: [DONE]\n\n"
            )).create_async().await;
        use tauri::Listener;
        let events=Arc::new(std::sync::Mutex::new(Vec::<QaEvent>::new()));
        let captured=events.clone();
        app.listen("qa-event",move |event|{
            if let Ok(payload)=serde_json::from_str::<QaEvent>(event.payload()){captured.lock().unwrap().push(payload);}
        });
        ask(state,app.handle().clone(),db::get_paper(&db,&item_id).unwrap(),"再次提问".into()).await.unwrap();
        let messages=db::list_qa(&db,&item_id).unwrap();
        assert_eq!(messages.last().map(|message|(&message.role,&message.content)),Some((&"assistant".into(),&"正常回答".into())));
        let events=events.lock().unwrap();
        assert!(events.iter().any(|event|event.item_id==item_id&&event.kind=="delta"&&event.text.as_deref()==Some("正常回答")));
        assert!(events.iter().any(|event|event.kind=="done"));
        normal.assert_async().await;
        std::env::remove_var("DEEPSEEK_API_KEY");std::env::remove_var("DEEPSEEK_BASE_URL");std::env::remove_var("DEEPSEEK_MODEL");
    }
}
