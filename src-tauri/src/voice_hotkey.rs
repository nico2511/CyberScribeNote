use tauri_plugin_global_shortcut::Shortcut;

/// Parse une touche globale Tauri (ex. `F8`, `Ctrl+Shift+V`).
pub fn parse_hotkey(raw: &str) -> Result<Shortcut, String> {
    let normalized = raw.trim().replace(' ', "");
    if normalized.is_empty() {
        return "F8".parse::<Shortcut>().map_err(|e| e.to_string());
    }
    normalized.parse::<Shortcut>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_hotkey;

    #[test]
    fn empty_defaults_to_f8() {
        assert!(parse_hotkey("").is_ok());
        assert!(parse_hotkey("   ").is_ok());
    }

    #[test]
    fn parses_named_key() {
        assert!(parse_hotkey("F9").is_ok());
    }
}
