use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

/// Bloque loopback, link-local et plages privées (SSRF fetch_page_meta).
pub fn validate_public_http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "URL invalide.".to_string())?;
    let scheme = url.scheme();
    if scheme != "https" {
        return Err("Seules les URLs https sont autorisées.".into());
    }
    validate_host_not_private(url.host_str().ok_or("Hôte manquant.")?)?;
    Ok(url)
}

/// Ollama : localhost, loopback et LAN privé autorisés ; schéma http(s) uniquement.
pub fn validate_ollama_host(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Hôte Ollama vide.".into());
    }
    let url = Url::parse(trimmed).map_err(|_| "URL Ollama invalide.".to_string())?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Ollama : schéma http ou https requis.".into());
    }
    if url.host_str().is_none() {
        return Err("Hôte Ollama manquant.".into());
    }
    Ok(trimmed.to_string())
}

fn validate_host_not_private(host: &str) -> Result<(), String> {
    let lower = host.to_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err("Accès localhost refusé.".into());
    }
    if lower == "metadata.google.internal" || lower == "169.254.169.254" {
        return Err("Hôte bloqué.".into());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Adresse privée ou locale refusée.".into());
        }
        return Ok(());
    }

    // Nom d'hôte résolu côté client requête — on bloque les formes IP-like en littéral.
    Ok(())
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_ipv4(v4),
        IpAddr::V6(v6) => is_blocked_ipv6(v6),
    }
}

fn is_blocked_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.octets()[0] == 0
        || ip == Ipv4Addr::new(169, 254, 169, 254)
        || ip == Ipv4Addr::new(100, 64, 0, 0) // CGNAT
}

fn is_blocked_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || (ip.segments()[0] & 0xfe00) == 0xfc00 // unique local
        || (ip.segments()[0] & 0xffc0) == 0xfe80 // link-local
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_localhost_https() {
        assert!(validate_public_http_url("https://localhost/").is_err());
        assert!(validate_public_http_url("https://127.0.0.1/").is_err());
    }

    #[test]
    fn allows_public_https() {
        assert!(validate_public_http_url("https://example.com/page").is_ok());
    }

    #[test]
    fn blocks_http_for_page_meta() {
        assert!(validate_public_http_url("http://example.com/").is_err());
    }

    #[test]
    fn allows_ollama_localhost() {
        assert!(validate_ollama_host("http://127.0.0.1:11434").is_ok());
    }
}
