use crate::{archive,credentials::{self,ApiService},state::AppState};
use anyhow::{Context,Result};
use serde::Deserialize;
use serde_json::json;
use std::{path::PathBuf,time::Duration};

const BASE:&str="https://v2.doc2x.noedgeai.com/api/v2";

#[derive(Deserialize)]struct Envelope{code:String,msg:Option<String>,data:Option<serde_json::Value>}
#[derive(Deserialize)]struct Task{uid:String,url:String}

fn key()->Result<String>{credentials::get(ApiService::Doc2x)}
async fn api(client:&reqwest::Client,method:reqwest::Method,path:&str,body:Option<serde_json::Value>)->Result<serde_json::Value>{
    let mut request=client.request(method,format!("{}{}",BASE,path)).bearer_auth(key()?);
    if let Some(body)=body{request=request.json(&body);}
    let response=request.send().await?;let status=response.status();
    if !status.is_success(){anyhow::bail!("Doc2X HTTP {}：{}",status,response.text().await.unwrap_or_default());}
    let envelope:Envelope=response.json().await?;
    if envelope.code!="success"{anyhow::bail!("Doc2X {}：{}",envelope.code,envelope.msg.unwrap_or_default());}
    envelope.data.context("Doc2X 响应缺少 data")
}

async fn wait_task(client:&reqwest::Client,path:&str,uid:&str)->Result<serde_json::Value>{
    let deadline=tokio::time::Instant::now()+Duration::from_secs(60*30);
    loop{
        if tokio::time::Instant::now()>deadline{anyhow::bail!("Doc2X 任务等待超时，任务 ID：{}",uid);}
        let data=api(client,reqwest::Method::GET,&format!("{}?uid={}",path,uid),None).await?;
        match data.get("status").and_then(|s|s.as_str()).unwrap_or_default(){
            "success"=>return Ok(data),"failed"=>anyhow::bail!("Doc2X 任务失败：{}",data.get("detail").and_then(|d|d.as_str()).unwrap_or("未知原因")),
            _=>tokio::time::sleep(Duration::from_secs(3)).await,
        }
    }
}

fn allowed_hosts()->Vec<String>{crate::environment::get("DOC2X_DOWNLOAD_HOSTS").filter(|v|!v.trim().is_empty()).map(|v|v.split(',').map(str::trim).filter(|s|!s.is_empty()).map(str::to_string).collect()).unwrap_or_else(||vec!["doc2x.noedgeai.com".into(),"noedgeai.com".into(),"aliyuncs.com".into()])}

pub async fn parse_pdf(state:&AppState,item_id:&str,pdf_key:&str,version_id:&str)->Result<(PathBuf,String,String)>{
    let pdf=state.zotero().file(pdf_key).await?;
    if !pdf.starts_with(b"%PDF-"){anyhow::bail!("Zotero 附件不是有效 PDF");}
    let pre=serde_json::from_value::<Task>(api(&state.http,reqwest::Method::POST,"/parse/preupload",Some(json!({"model":"v3-2026"}))).await?)?;
    let upload_url=url::Url::parse(&pre.url)?;
    if upload_url.scheme()!="https"{anyhow::bail!("Doc2X 上传地址不是 HTTPS");}
    let response=state.http.put(upload_url).body(pdf).send().await.map_err(|error|anyhow::anyhow!(error.without_url())).context("上传 PDF 到 Doc2X 失败")?;
    if !response.status().is_success(){anyhow::bail!("PDF 上传失败（{}）",response.status());}
    wait_task(&state.http,"/parse/status",&pre.uid).await?;
    api(&state.http,reqwest::Method::POST,"/convert/parse",Some(json!({"uid":pre.uid,"to":"md","formula_mode":"normal","filename":"paper","merge_cross_page_forms":false,"formula_level":0}))).await?;
    let result=wait_task(&state.http,"/convert/parse/result",&pre.uid).await?;
    let raw_url=result.get("url").and_then(|u|u.as_str()).context("Doc2X 未返回 ZIP 地址")?.replace("\\u0026","&");
    let url=archive::validate_download_url(&raw_url,&allowed_hosts())?;
    let version_dir=state.data_dir.join("files").join(item_id).join(version_id);
    let temp=tempfile::tempdir_in(state.data_dir.join("tmp")).context("无法创建 Doc2X 临时目录")?;let zip_path=temp.path().join("result.zip");
    let sha=archive::download_zip(&state.http,url,&zip_path).await.context("无法下载 Doc2X 解析结果")?;
    archive::extract_atomic(&zip_path,&version_dir).with_context(||format!("无法写入解析目录：{}",version_dir.display()))?;
    let (_,markdown)=archive::read_main_markdown(&version_dir).with_context(||format!("无法读取解析结果：{}",version_dir.display()))?;
    Ok((version_dir,markdown,sha))
}
