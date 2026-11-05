use std::collections::HashMap;
use std::sync::OnceLock;

const SUPPORTED:&[&str]=&[
    "DEEPSEEK_API_KEY","DOC2X_API_KEY","DEEPSEEK_MODEL","DEEPSEEK_BASE_URL",
    "DOC2X_DOWNLOAD_HOSTS","ZOTERO_DATA_DIR","ZOTERO_ROOT_DIR","ZOTERO_LOCAL_BASE_URL",
];

static SHELL_VALUES:OnceLock<HashMap<String,String>>=OnceLock::new();

fn non_empty(value:String)->Option<String>{
    let value=value.trim();
    (!value.is_empty()).then(||value.to_string())
}

fn config_key(name:&str)->Option<&'static str>{
    match name{
        "DEEPSEEK_MODEL"=>Some(crate::config::DEEPSEEK_MODEL),
        "DEEPSEEK_BASE_URL"=>Some(crate::config::DEEPSEEK_BASE_URL),
        "DOC2X_DOWNLOAD_HOSTS"=>Some(crate::config::DOC2X_DOWNLOAD_HOSTS),
        "ZOTERO_DATA_DIR"=>Some(crate::config::ZOTERO_DATA_DIR),
        "ZOTERO_ROOT_DIR"=>Some(crate::config::ZOTERO_ROOT_DIR),
        "ZOTERO_LOCAL_BASE_URL"=>Some(crate::config::ZOTERO_LOCAL_BASE_URL),
        _=>None,
    }
}

/// Read process and login-shell values without consulting the JSON config.
pub fn process_or_shell(name:&str)->Option<String>{
    if let Ok(value)=std::env::var(name){if let Some(value)=non_empty(value){return Some(value);}}
    #[cfg(target_os="macos")]
    if SUPPORTED.contains(&name){
        if let Some(value)=SHELL_VALUES.get_or_init(load_shell).get(name).cloned(){return Some(value);}
    }
    None
}

/// Explicit JSON settings win; environment variables remain a fallback.
pub fn get(name:&str)->Option<String>{
    if let Some(value)=config_key(name).and_then(crate::config::get){return Some(value);}
    process_or_shell(name)
}

#[cfg(target_os="macos")]
fn shell_command()->String{
    SUPPORTED.iter().map(|name|format!("printf '\\036{}=%s\\0' \"${}\"",name,name)).collect::<Vec<_>>().join(";")
}

fn parse_account_shell(output:&str)->Option<&'static str>{
    match output.trim().strip_prefix("UserShell:")?.trim(){"/bin/zsh"=>Some("/bin/zsh"),"/bin/bash"=>Some("/bin/bash"),_=>None}
}

#[cfg(target_os="macos")]
fn account_shell()->String{
    use std::process::Command;

    // LaunchServices and parent processes may provide a SHELL that differs from
    // the account's login shell. Ask macOS instead of trusting that variable.
    let user=std::env::var("USER").or_else(|_|std::env::var("LOGNAME")).unwrap_or_default();
    if !user.is_empty(){
        if let Ok(output)=Command::new("/usr/bin/dscl").args([".","-read",&format!("/Users/{user}"),"UserShell"]).output(){
            if output.status.success(){
                if let Some(shell)=parse_account_shell(&String::from_utf8_lossy(&output.stdout)){return shell.into();}
            }
        }
    }
    let configured=std::env::var("SHELL").unwrap_or_default();
    match configured.as_str(){"/bin/zsh"|"/bin/bash"=>configured,_=>"/bin/zsh".into()}
}

#[cfg(target_os="macos")]
fn load_shell()->HashMap<String,String>{
    use std::io::Read;
    use std::process::{Command,Stdio};
    use std::time::Duration;
    use wait_timeout::ChildExt;

    let shell=account_shell();
    let mut child=match Command::new(shell).arg("-lic").arg(shell_command()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn(){
        Ok(child)=>child,
        Err(_)=>return HashMap::new(),
    };
    match child.wait_timeout(Duration::from_secs(4)){
        Ok(Some(status)) if status.success()=>{}
        Ok(Some(_))=>return HashMap::new(),
        Ok(None)=>{
            let _=child.kill();
            let _=child.wait();
            return HashMap::new();
        }
        Err(_)=>return HashMap::new(),
    }
    let mut output=String::new();
    if child.stdout.take().and_then(|mut stdout|stdout.read_to_string(&mut output).ok()).is_none(){return HashMap::new();}
    parse_shell_output(&output)
}

#[cfg_attr(not(target_os="macos"),allow(dead_code))]
fn parse_shell_output(output:&str)->HashMap<String,String>{
    let mut values=HashMap::new();
    for record in output.split('\0'){
        let Some((_,record))=record.rsplit_once('\u{1e}')else{continue};
        let Some((name,value))=record.split_once('=')else{continue};
        if SUPPORTED.contains(&name){if let Some(value)=non_empty(value.to_string()){values.insert(name.to_string(),value);}}
    }
    values
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn parses_only_supported_non_empty_shell_values(){
        let values=parse_shell_output("startup noise\n\u{1e}DEEPSEEK_API_KEY= secret \0\u{1e}DOC2X_API_KEY=\0\u{1e}UNKNOWN=ignored\0\u{1e}ZOTERO_DATA_DIR=/Users/test/Zotero\0");
        assert_eq!(values.get("DEEPSEEK_API_KEY").map(String::as_str),Some("secret"));
        assert!(!values.contains_key("DOC2X_API_KEY"));
        assert!(!values.contains_key("UNKNOWN"));
        assert_eq!(values.get("ZOTERO_DATA_DIR").map(String::as_str),Some("/Users/test/Zotero"));
    }

    #[test]
    fn uses_the_macos_account_login_shell_instead_of_an_arbitrary_parent_shell(){
        assert_eq!(parse_account_shell("UserShell: /bin/zsh\n"),Some("/bin/zsh"));
        assert_eq!(parse_account_shell("UserShell: /bin/bash\n"),Some("/bin/bash"));
        assert_eq!(parse_account_shell("UserShell: /bin/fish\n"),None);
        assert_eq!(parse_account_shell("invalid\n"),None);
    }
}
