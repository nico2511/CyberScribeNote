use std::path::Path;

/// Refuse `..`, chemins absolus et lettres de lecteur Windows.
pub fn is_safe_vault_relative(relative: &str) -> bool {
    if relative.is_empty() {
        return true;
    }
    let norm = relative.replace('\\', "/");
    if Path::new(&norm).is_absolute() {
        return false;
    }
    if norm.starts_with('/') {
        return false;
    }
    if norm.len() >= 2 && norm.as_bytes()[1] == b':' {
        return false;
    }
    !norm.split('/').any(|part| part == "..")
}

#[cfg(test)]
mod tests {
    use super::is_safe_vault_relative;

    #[test]
    fn accepts_normal_note_paths() {
        assert!(is_safe_vault_relative("Bienvenue.md"));
        assert!(is_safe_vault_relative("dossier/note.md"));
        assert!(is_safe_vault_relative("a/b/c.md"));
        assert!(is_safe_vault_relative(""));
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(!is_safe_vault_relative("../secret.md"));
        assert!(!is_safe_vault_relative("notes/../../etc/passwd"));
        assert!(!is_safe_vault_relative(r"..\windows\system32"));
        assert!(!is_safe_vault_relative(r"C:\Windows\notepad.exe"));
        assert!(!is_safe_vault_relative("/etc/passwd"));
    }
}
