use crate::models::Figure;
use anyhow::{Context, Result};
use futures_util::StreamExt;
use sha2::{Digest,Sha256};
use std::{io::{Read,Write},path::{Component,Path,PathBuf}};
use url::Url;

const MAX_ZIP_SIZE:u64=512*1024*1024;
const MAX_UNPACKED_SIZE:u64=1024*1024*1024;
const MAX_FILES:usize=2000;

pub fn validate_download_url(raw:&str,allowed:&[String])->Result<Url>{
    let url=Url::parse(raw).context("Doc2X 返回了无效下载地址")?;
    if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some(){anyhow::bail!("下载地址必须使用 HTTPS 且不能包含凭据");}
    let host=url.host_str().context("下载地址缺少域名")?.to_ascii_lowercase();
    if !allowed.iter().map(|h|h.trim().trim_start_matches('.').to_ascii_lowercase()).any(|allowed|host==allowed||host.ends_with(&format!(".{}",allowed))){anyhow::bail!("下载域名 {} 不在可信白名单内",host);}
    Ok(url)
}

pub async fn download_zip(client:&reqwest::Client,url:Url,destination:&Path)->Result<String>{
    let response=client.get(url).send().await?;
    if !response.status().is_success(){anyhow::bail!("ZIP 下载失败（{}）",response.status());}
    if response.content_length().is_some_and(|size|size>MAX_ZIP_SIZE){anyhow::bail!("ZIP 超过 512 MiB 安全限制");}
    let mut file=std::fs::File::create(destination)?;
    let mut hash=Sha256::new();let mut size=0u64;let mut stream=response.bytes_stream();
    while let Some(chunk)=stream.next().await{
        let chunk=chunk?;size+=chunk.len() as u64;
        if size>MAX_ZIP_SIZE{anyhow::bail!("ZIP 超过 512 MiB 安全限制");}
        hash.update(&chunk);file.write_all(&chunk)?;
    }
    file.sync_all()?;Ok(hex::encode(hash.finalize()))
}

fn safe_relative(path:&Path)->Result<PathBuf>{
    if path.is_absolute(){anyhow::bail!("ZIP 包含绝对路径");}
    let mut clean=PathBuf::new();
    for component in path.components(){match component{Component::Normal(part)=>clean.push(part),Component::CurDir=>{},_=>anyhow::bail!("ZIP 包含不安全路径")}}
    Ok(clean)
}

pub fn extract_atomic(zip_path:&Path,target:&Path)->Result<()>{
    let parent=target.parent().context("解析目录缺少父目录")?;std::fs::create_dir_all(parent)?;
    let temp=tempfile::tempdir_in(parent)?;
    let file=std::fs::File::open(zip_path)?;let mut archive=zip::ZipArchive::new(file)?;
    if archive.len()>MAX_FILES{anyhow::bail!("ZIP 文件条目过多");}
    let mut total=0u64;
    for index in 0..archive.len(){
        let mut entry=archive.by_index(index)?;
        if entry.is_dir(){continue;}
        if entry.unix_mode().is_some_and(|mode|mode&0o170000==0o120000){anyhow::bail!("ZIP 不允许符号链接");}
        if entry.size()>MAX_UNPACKED_SIZE||entry.compressed_size()>0&&entry.size()/entry.compressed_size().max(1)>250{anyhow::bail!("疑似解压炸弹");}
        total=total.checked_add(entry.size()).context("ZIP 尺寸溢出")?;
        if total>MAX_UNPACKED_SIZE{anyhow::bail!("ZIP 解压后超过 1 GiB 安全限制");}
        let relative=safe_relative(Path::new(entry.name()))?;
        if relative.as_os_str().is_empty(){continue;}
        let output=temp.path().join(relative);
        if let Some(parent)=output.parent(){std::fs::create_dir_all(parent)?;}
        let mut out=std::fs::File::create(&output)?;std::io::copy(&mut entry,&mut out)?;
    }
    let staging=parent.join(format!(".staging-{}",uuid::Uuid::new_v4()));
    std::fs::rename(temp.path(),&staging)?;
    if target.exists(){std::fs::remove_dir_all(target)?;}
    std::fs::rename(&staging,target)?;
    Ok(())
}

pub fn read_main_markdown(version_dir:&Path)->Result<(PathBuf,String)>{
    let mut files=Vec::new();collect_markdown(version_dir,version_dir,&mut files)?;
    let path=files.into_iter().min_by_key(|path|if path.file_name().and_then(|n|n.to_str()).is_some_and(|n|n.eq_ignore_ascii_case("full.md")){0}else{1}).context("ZIP 中没有 Markdown 文件")?;
    let content=std::fs::read_to_string(version_dir.join(&path))?;
    if content.trim().is_empty(){anyhow::bail!("解析结果 Markdown 为空");}
    Ok((path,content))
}
fn collect_markdown(root:&Path,dir:&Path,out:&mut Vec<PathBuf>)->Result<()>{
    for entry in std::fs::read_dir(dir)?{let entry=entry?;let path=entry.path();if path.is_dir(){collect_markdown(root,&path,out)?}else if path.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("md")){out.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());}}
    Ok(())
}

pub fn figures_from_markdown(markdown:&str)->Vec<Figure>{
    let mut figures=Vec::new();let mut section=String::new();
    for line in markdown.lines(){
        if let Some(title)=line.strip_prefix('#'){section=title.trim_start_matches('#').trim().to_string();}
        let Some(start)=line.find("![")else{continue};let Some(mid)=line[start+2..].find("](")else{continue};
        let caption=line[start+2..start+2+mid].trim().to_string();let path_start=start+2+mid+2;
        let Some(end)=line[path_start..].find(')')else{continue};let raw=line[path_start..path_start+end].split_whitespace().next().unwrap_or_default();
        let path=raw.trim_matches('<').trim_matches('>').split('#').next().unwrap_or_default().to_string();
        if path.is_empty()||path.starts_with("http:")||path.starts_with("https:")||path.starts_with("data:"){continue;}
        let label=caption.split(['：',':']).next().filter(|s|s.contains("图")||s.to_ascii_lowercase().starts_with("fig")).unwrap_or(&section).to_string();
        figures.push(Figure{path,caption:if caption.is_empty(){format!("论文图片 {}",figures.len()+1)}else{caption},label:if label.is_empty(){format!("图 {}",figures.len()+1)}else{label},source:if section.is_empty(){None}else{Some(section.clone())}});
    }
    figures
}

pub fn read_asset(data_dir:&Path,item_id:&str,version_id:&str,relative:&str)->Result<(String,Vec<u8>)>{
    let root=data_dir.join("files").join(item_id).join(version_id).canonicalize()?;
    let clean=safe_relative(Path::new(relative))?;
    let path=root.join(clean).canonicalize()?;
    if !path.starts_with(&root)||!path.is_file(){anyhow::bail!("图片路径越界或不存在");}
    if path.metadata()?.len()>25*1024*1024{anyhow::bail!("图片超过 25 MiB 限制");}
    let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();
    let mut bytes=Vec::new();std::fs::File::open(path)?.read_to_end(&mut bytes)?;Ok((mime,bytes))
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn rejects_untrusted_and_http_urls(){let hosts=vec!["example.com".into()];assert!(validate_download_url("http://example.com/a.zip",&hosts).is_err());assert!(validate_download_url("https://evil.com/a.zip",&hosts).is_err());assert!(validate_download_url("https://cdn.example.com/a.zip",&hosts).is_ok());}
    #[test]fn rejects_zip_slip(){assert!(safe_relative(Path::new("../../secret")).is_err());assert!(safe_relative(Path::new("/etc/passwd")).is_err());}
    #[test]fn extracts_ordered_figures(){let f=figures_from_markdown("# 结果\n![图 1：准确率](figures/a.png)\n![表 2](figures/b.jpg)");assert_eq!(f.len(),2);assert_eq!(f[0].path,"figures/a.png");assert_eq!(f[0].source.as_deref(),Some("结果"));}
    #[test]fn reads_relative_markdown_from_its_version_directory(){
        let temp=tempfile::tempdir().unwrap();let version=temp.path().join("version");std::fs::create_dir_all(version.join("nested")).unwrap();
        std::fs::write(version.join("nested/full.md"),"# 正文").unwrap();
        let (path,content)=read_main_markdown(&version).unwrap();
        assert_eq!(path,PathBuf::from("nested/full.md"));assert_eq!(content,"# 正文");
    }
}
