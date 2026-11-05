use anyhow::{Context,Result};
use serde_json::{Map,Value};
use std::{io::Write,path::{Path,PathBuf},sync::{Mutex,OnceLock}};

pub const DEEPSEEK_API_KEY:&str="deepseek.apiKey";
pub const DOC2X_API_KEY:&str="doc2x.apiKey";
pub const DEEPSEEK_MODEL:&str="deepseek.model";
pub const DEEPSEEK_BASE_URL:&str="deepseek.baseUrl";
pub const DOC2X_DOWNLOAD_HOSTS:&str="doc2x.downloadHosts";
pub const ZOTERO_DATA_DIR:&str="zotero.dataDir";
pub const ZOTERO_ROOT_DIR:&str="zotero.rootDir";
pub const ZOTERO_LOCAL_BASE_URL:&str="zotero.localBaseUrl";
pub const LITERATURE_PROMPT:&str="literatureInterpretation.prompt";

const DEFAULT_PROMPT:&str=include_str!("../../prompts/literature_interpretation.txt");
static CONFIG_PATH:OnceLock<PathBuf>=OnceLock::new();
static CONFIG_LOCK:Mutex<()>=Mutex::new(());

fn defaults()->Map<String,Value>{
    let values=[
        (DEEPSEEK_API_KEY,""),(DOC2X_API_KEY,""),
        (DEEPSEEK_MODEL,"deepseek-v4-flash-vision-exp"),
        (DEEPSEEK_BASE_URL,"https://api.deepseek.com"),
        (DOC2X_DOWNLOAD_HOSTS,"doc2x.noedgeai.com,noedgeai.com,aliyuncs.com"),
        (ZOTERO_DATA_DIR,""),(ZOTERO_ROOT_DIR,""),
        (ZOTERO_LOCAL_BASE_URL,"http://127.0.0.1:23119/api/users/0"),
        (LITERATURE_PROMPT,DEFAULT_PROMPT),
    ];
    values.into_iter().map(|(key,value)|(key.to_string(),Value::String(value.to_string()))).collect()
}

fn read_config(path:&Path)->Result<Map<String,Value>>{
    if !path.exists(){return Ok(Map::new());}
    let text=std::fs::read_to_string(path).with_context(||format!("无法读取应用配置文件：{}",path.display()))?;
    let value:Value=serde_json::from_str(&text).with_context(||format!("应用配置文件不是有效 JSON：{}",path.display()))?;
    value.as_object().cloned().context("应用配置文件顶层必须是 JSON 对象")
}

fn write_config(path:&Path,config:&Map<String,Value>)->Result<()>{
    let parent=path.parent().context("应用配置文件缺少父目录")?;std::fs::create_dir_all(parent)?;
    let mut temp=tempfile::NamedTempFile::new_in(parent).context("无法创建配置文件临时文件")?;
    serde_json::to_writer_pretty(&mut temp,config).context("无法序列化应用配置")?;temp.write_all(b"\n")?;temp.as_file().sync_all()?;
    temp.persist(path).with_context(||format!("无法写入应用配置文件：{}",path.display()))?;Ok(())
}

fn value<'a>(config:&'a Map<String,Value>,key:&str)->Option<&'a str>{
    config.get(key).and_then(Value::as_str).map(str::trim).filter(|value|!value.is_empty())
}

fn get_from(path:&Path,key:&str)->Result<Option<String>>{
    Ok(value(&read_config(path)?,key).map(str::to_owned))
}

fn set_from(path:&Path,key:&str,new_value:&str)->Result<()>{
    let mut config=read_config(path)?;config.insert(key.to_string(),Value::String(new_value.to_string()));write_config(path,&config)
}

fn inherit_environment(config:&mut Map<String,Value>,mut lookup:impl FnMut(&str)->Option<String>)->bool{
    if config.contains_key("config.version"){return false;}
    let mappings=[
        ("DEEPSEEK_API_KEY",DEEPSEEK_API_KEY),("DOC2X_API_KEY",DOC2X_API_KEY),
        ("DEEPSEEK_MODEL",DEEPSEEK_MODEL),("DEEPSEEK_BASE_URL",DEEPSEEK_BASE_URL),
        ("DOC2X_DOWNLOAD_HOSTS",DOC2X_DOWNLOAD_HOSTS),("ZOTERO_DATA_DIR",ZOTERO_DATA_DIR),
        ("ZOTERO_ROOT_DIR",ZOTERO_ROOT_DIR),("ZOTERO_LOCAL_BASE_URL",ZOTERO_LOCAL_BASE_URL),
    ];
    for (environment,key) in mappings{if let Some(value)=lookup(environment){config.insert(key.to_string(),Value::String(value));}}
    config.insert("config.version".to_string(),Value::Number(1.into()));true
}

pub fn init(data_dir:&Path)->Result<PathBuf>{
    let path=CONFIG_PATH.get_or_init(||data_dir.join("config.json")).clone();
    let _lock=CONFIG_LOCK.lock().map_err(|_|anyhow::anyhow!("配置锁不可用"))?;
    let mut config=read_config(&path)?;let mut changed=inherit_environment(&mut config,crate::environment::process_or_shell);
    for (key,default) in defaults(){if !config.contains_key(&key){config.insert(key,default);changed=true;}}
    if changed||!path.exists(){write_config(&path,&config)?;}
    Ok(path)
}

pub fn path()->Option<PathBuf>{CONFIG_PATH.get().cloned()}

pub fn get(key:&str)->Option<String>{
    CONFIG_PATH.get().and_then(|path|get_from(path,key).ok()).flatten()
}

pub fn set(key:&str,value:&str)->Result<()>{
    let path=CONFIG_PATH.get().context("应用配置尚未初始化")?;
    let _lock=CONFIG_LOCK.lock().map_err(|_|anyhow::anyhow!("配置锁不可用"))?;
    set_from(path,key,value)
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn writes_vscode_style_plain_json_and_preserves_other_settings(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("config.json");
        set_from(&path,DEEPSEEK_API_KEY,"  test-secret  ").unwrap();
        set_from(&path,LITERATURE_PROMPT,"自定义提示词").unwrap();
        let config=read_config(&path).unwrap();
        assert_eq!(value(&config,DEEPSEEK_API_KEY),Some("test-secret"));
        assert_eq!(get_from(&path,LITERATURE_PROMPT).unwrap().as_deref(),Some("自定义提示词"));
        let text=std::fs::read_to_string(path).unwrap();
        assert!(text.contains("\"deepseek.apiKey\": \"  test-secret  \""));
        assert!(text.contains("\"literatureInterpretation.prompt\": \"自定义提示词\""));
    }

    #[test]
    fn initialization_adds_defaults_without_overwriting_custom_values(){
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("config.json");
        set_from(&path,DEEPSEEK_MODEL,"custom-model").unwrap();
        let mut config=read_config(&path).unwrap();
        for (key,default) in defaults(){if !config.contains_key(&key){config.insert(key,default);}}
        write_config(&path,&config).unwrap();
        assert_eq!(get_from(&path,DEEPSEEK_MODEL).unwrap().as_deref(),Some("custom-model"));
        assert_eq!(get_from(&path,LITERATURE_PROMPT).unwrap().as_deref(),Some(DEFAULT_PROMPT.trim_end()));
        assert!(path.exists());
    }

    #[test]
    fn inherits_environment_only_once_before_file_settings_take_priority(){
        let mut config=Map::new();
        assert!(inherit_environment(&mut config,|name|(name=="DEEPSEEK_API_KEY").then(||"from-environment".to_string())));
        assert_eq!(value(&config,DEEPSEEK_API_KEY),Some("from-environment"));
        config.insert(DEEPSEEK_MODEL.to_string(),Value::String("from-user".to_string()));
        assert!(!inherit_environment(&mut config,|_|Some("should-not-win".to_string())));
        assert_eq!(value(&config,DEEPSEEK_MODEL),Some("from-user"));
    }
}
