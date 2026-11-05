use crate::{models::BackupManifest,state::AppState};
use anyhow::{Context,Result};
use chrono::Utc;
use rusqlite::Connection;
use std::{io::Write,path::{Path,PathBuf}};
use zip::write::SimpleFileOptions;

fn add_dir(zip:&mut zip::ZipWriter<std::fs::File>,root:&Path,dir:&Path,prefix:&str)->Result<()>{
    for entry in std::fs::read_dir(dir)?{let entry=entry?;let path=entry.path();if path.is_dir(){add_dir(zip,root,&path,prefix)?}else{let relative=path.strip_prefix(root)?;let name=format!("{}/{}",prefix,relative.to_string_lossy().replace('\\',"/"));zip.start_file(name,SimpleFileOptions::default())?;let mut file=std::fs::File::open(&path)?;std::io::copy(&mut file,zip)?;}}
    Ok(())
}

pub fn export(state:&AppState,destination:&Path)->Result<()>{
    let temp=tempfile::tempdir_in(state.data_dir.join("tmp"))?;let snapshot=temp.path().join("reader.db");
    {let conn=state.db.lock().map_err(|_|anyhow::anyhow!("数据库锁定失败"))?;conn.execute("PRAGMA wal_checkpoint(FULL)",[])?;conn.execute("VACUUM INTO ?1",[snapshot.to_string_lossy().to_string()])?;}
    let file=std::fs::File::create(destination)?;let mut zip=zip::ZipWriter::new(file);
    let manifest=BackupManifest{format:"zotero-reader-backup".into(),version:1,exported_at:Utc::now().to_rfc3339(),database:"reader.db".into(),files_dir:"files".into()};
    zip.start_file("manifest.json",SimpleFileOptions::default())?;zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    zip.start_file("reader.db",SimpleFileOptions::default())?;let mut db=std::fs::File::open(snapshot)?;std::io::copy(&mut db,&mut zip)?;
    let files=state.data_dir.join("files");if files.exists(){add_dir(&mut zip,&files,&files,"files")?;}
    zip.finish()?;Ok(())
}

fn restore_path(base:&Path,name:&str)->Result<PathBuf>{let path=Path::new(name);if path.is_absolute()||path.components().any(|c|matches!(c,std::path::Component::ParentDir)){anyhow::bail!("备份包含不安全路径");}Ok(base.join(path))}

pub fn restore(state:&AppState,source:&Path)->Result<()>{
    let temp=tempfile::tempdir_in(state.data_dir.join("tmp"))?;let file=std::fs::File::open(source)?;let mut archive=zip::ZipArchive::new(file)?;
    if archive.len()>10000{anyhow::bail!("备份文件条目过多");}
    let mut total=0u64;
    for i in 0..archive.len(){let mut entry=archive.by_index(i)?;total+=entry.size();if total>2*1024*1024*1024{anyhow::bail!("备份解压后过大");}if entry.is_dir(){continue;}let output=restore_path(temp.path(),entry.name())?;if let Some(parent)=output.parent(){std::fs::create_dir_all(parent)?;}let mut out=std::fs::File::create(output)?;std::io::copy(&mut entry,&mut out)?;}
    let manifest:BackupManifest=serde_json::from_str(&std::fs::read_to_string(temp.path().join("manifest.json"))?)?;if manifest.format!="zotero-reader-backup"||manifest.version!=1{anyhow::bail!("不支持的备份格式或版本");}
    let imported=Connection::open(temp.path().join("reader.db"))?;imported.query_row("SELECT COUNT(*) FROM items",[],|_|Ok(())).context("备份数据库无效")?;
    {let mut destination=state.db.lock().map_err(|_|anyhow::anyhow!("数据库锁定失败"))?;let backup=rusqlite::backup::Backup::new(&imported,&mut destination)?;backup.run_to_completion(5,std::time::Duration::from_millis(50),None)?;}
    let restored=temp.path().join("files");let target=state.data_dir.join("files");
    if restored.exists(){let previous=state.data_dir.join(format!("files-before-restore-{}",uuid::Uuid::new_v4()));if target.exists(){std::fs::rename(&target,&previous)?;}std::fs::rename(restored,target)?;let _=std::fs::remove_dir_all(previous);}
    Ok(())
}
