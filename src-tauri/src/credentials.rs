use anyhow::{Context,Result};

const KEYRING_SERVICE:&str="com.zoteroreader.desktop";

#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum ApiService{Deepseek,Doc2x}

impl ApiService{
    pub fn parse(value:&str)->Option<Self>{match value{"deepseek"=>Some(Self::Deepseek),"doc2x"=>Some(Self::Doc2x),_=>None}}
    fn env_var(self)->&'static str{match self{Self::Deepseek=>"DEEPSEEK_API_KEY",Self::Doc2x=>"DOC2X_API_KEY"}}
    fn config_key(self)->&'static str{match self{Self::Deepseek=>crate::config::DEEPSEEK_API_KEY,Self::Doc2x=>crate::config::DOC2X_API_KEY}}
    fn account(self)->&'static str{match self{Self::Deepseek=>"deepseek-api-key",Self::Doc2x=>"doc2x-api-key"}}
    fn missing_message(self)->String{match self{Self::Deepseek=>"未配置 DeepSeek API Key，请在设置中保存密钥、编辑 config.json 或设置 DEEPSEEK_API_KEY".into(),Self::Doc2x=>"未配置 Doc2X API Key，请在设置中保存密钥、编辑 config.json 或设置 DOC2X_API_KEY".into()}}
}

fn clean(value:&str)->Option<&str>{let key=value.trim();if key.is_empty(){None}else{Some(key)}}
fn environment(service:ApiService)->Option<String>{crate::environment::get(service.env_var()).and_then(|value|clean(&value).map(str::to_owned))}
fn stored(service:ApiService)->Option<String>{crate::config::get(service.config_key()).and_then(|value|clean(&value).map(str::to_owned))}
fn legacy_entry(service:ApiService)->Result<keyring::Entry>{keyring::Entry::new(KEYRING_SERVICE,service.account()).context("无法访问旧系统钥匙串")}

pub fn migrate_legacy(){
    for service in [ApiService::Deepseek,ApiService::Doc2x]{
        if stored(service).is_none(){
            if let Some(key)=legacy_entry(service).ok().and_then(|entry|entry.get_password().ok()).and_then(|value|clean(&value).map(str::to_owned)){
                if crate::config::set(service.config_key(),&key).is_err(){continue;}
            }
        }
        if stored(service).is_some(){if let Ok(entry)=legacy_entry(service){let _=entry.delete_credential();}}
    }
}

pub fn get(service:ApiService)->Result<String>{
    if let Some(key)=stored(service){return Ok(key);}
    environment(service).with_context(||service.missing_message())
}

pub fn is_configured(service:ApiService)->bool{stored(service).is_some()||environment(service).is_some()}

pub fn set(service:ApiService,key:&str)->Result<()>{
    let key=clean(key).context("API Key 不能为空")?;
    crate::config::set(service.config_key(),key).context("无法将 API Key 保存到应用配置文件")?;
    if let Ok(entry)=legacy_entry(service){let _=entry.delete_credential();}
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn parses_only_supported_services(){assert_eq!(ApiService::parse("deepseek"),Some(ApiService::Deepseek));assert_eq!(ApiService::parse("doc2x"),Some(ApiService::Doc2x));assert_eq!(ApiService::parse("other"),None);}
    #[test]fn trims_and_rejects_empty_keys(){assert_eq!(clean("  secret  "),Some("secret"));assert_eq!(clean("  "),None);assert_eq!(clean(""),None);}
}
