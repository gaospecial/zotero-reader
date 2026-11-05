mod archive;
mod backup;
mod commands;
mod config;
mod credentials;
mod db;
mod deepseek;
mod doc2x;
mod environment;
mod models;
mod pipeline;
mod state;
mod zotero;

use state::AppState;
use std::{collections::HashMap,sync::Arc,time::Duration};
use tauri::Manager;

#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app|{
            let data_dir=app.path().app_data_dir()?;std::fs::create_dir_all(data_dir.join("tmp"))?;
            config::init(&data_dir)?;credentials::migrate_legacy();
            let database=db::open(&data_dir.join("reader.db"))?;
            let http=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120)).user_agent("Zotero-Reader/0.1").build()?;
            let zotero_base=crate::environment::get("ZOTERO_LOCAL_BASE_URL").unwrap_or_else(||"http://127.0.0.1:23119/api/users/0".into());
            app.manage(Arc::new(AppState{db:database,data_dir,http,zotero_base,jobs:Arc::new(tokio::sync::Mutex::new(HashMap::new()))}));
            let handle=app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state=handle.state::<Arc<AppState>>();
                if state.zotero().check().await.is_ok() {
                    let _=zotero::sync_existing(&state).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,commands::connect_zotero,commands::startup_sync,commands::list_library,commands::get_paper_detail,
            commands::list_notes,commands::save_note,commands::list_qa,commands::clear_qa,commands::preview_import,commands::import_collections,commands::sync_collection,
            commands::list_pdf_choices,commands::choose_main_pdf,commands::retry_item,commands::regenerate_item,commands::cancel_item,
            commands::ask_question,commands::set_read_state,commands::trash_item,commands::restore_item,commands::sync_trash_to_zotero,
            commands::sync_zotero,commands::get_asset,commands::get_source_excerpt,commands::export_backup,commands::restore_backup,commands::open_zotero_pdf,commands::open_config_file,commands::service_configuration,commands::set_api_key
        ])
        .run(tauri::generate_context!()).expect("error while running Zotero Reader");
}
