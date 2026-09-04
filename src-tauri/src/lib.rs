mod commands;

use commands::{
    create_folder, create_note, delete_item, export_note, get_app_config,
    import_image, import_image_bytes, init_vault, list_vault, move_vault_item, ollama_delete_model,
    ollama_detect, ollama_install, ollama_pull_model, ollama_recommended_models,
    ollama_start_service, ollama_status, ollama_proactive_suggest, ollama_custom_prompt,
    ollama_summarize_note, ollama_transform_note, rag_query, rag_reindex, rag_status, read_note,
    save_app_config, search_vault, setup_voice, voice_check_deps,
    voice_get_status, voice_install_deps, voice_list_whisper_cache, voice_models_dir,
    voice_preload_whisper_model, voice_restart, voice_toggle, write_note, VoiceState,
};

use std::sync::{Arc, Mutex};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Arc::new(Mutex::new(VoiceState::default())))
        .setup(|app| {
            if let Err(e) = setup_voice(&app.handle()) {
                eprintln!("Voice setup: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                if let Some(state) = window.try_state::<Arc<Mutex<VoiceState>>>() {
                    if let Ok(mut guard) = state.lock() {
                        guard.stop_worker();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            init_vault,
            list_vault,
            read_note,
            write_note,
            create_note,
            create_folder,
            delete_item,
            move_vault_item,
            export_note,
            import_image,
            import_image_bytes,
            search_vault,
            get_app_config,
            save_app_config,
            ollama_detect,
            ollama_status,
            ollama_recommended_models,
            ollama_pull_model,
            ollama_delete_model,
            ollama_install,
            ollama_start_service,
            ollama_custom_prompt,
            ollama_summarize_note,
            ollama_proactive_suggest,
            ollama_transform_note,
            rag_status,
            rag_reindex,
            rag_query,
            voice_check_deps,
            voice_get_status,
            voice_toggle,
            voice_install_deps,
            voice_restart,
            voice_models_dir,
            voice_list_whisper_cache,
            voice_preload_whisper_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
