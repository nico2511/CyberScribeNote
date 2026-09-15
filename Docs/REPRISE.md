# Point de reprise — CyberScribeNote

**Dernière version publiée :** [v0.5.5](https://github.com/nico2511/CyberScribeNote/releases/tag/v0.5.5)  
**Branche :** `main`  
**État code :** clean

Document écrit pour reprendre après réinstallation Windows.

---

## 1. Après réinstall — checklist

### Récupérer le code
```powershell
git clone https://github.com/nico2511/CyberScribeNote.git
cd CyberScribeNote
npm install
```

### Prérequis dev
- Node.js 18+
- Rust (rustup) — sur Linux : libs Tauri (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`) pour `cargo test`
- Python 3.10+ (voix en mode Python, ou pour builder le sidecar)
- Ollama (optionnel, IA / RAG)
- [GitHub CLI `gh`](https://cli.github.com/) si tu publies des releases

### Lancer en dev
```powershell
npm run tauri dev
```

### Build + package Windows (release)
```powershell
npm run release:win
# puis zipper UNIQUEMENT les 2 exe dans dist-release/ :
#   cyberscribe-note.exe + voice_worker.exe
# Attention : ne pas inclure un ancien .zip dans l’archive (bug v0.5.3 ~400 Mo).
```

### Données utilisateur (survivent hors du repo)
| Chemin | Contenu |
|--------|---------|
| `Documents/CyberScribeNote/vault/` | Notes Markdown (défaut) |
| `Documents/CyberScribeNote/models/` | Modèles Whisper |
| `Documents/CyberScribeNote/voice_worker.log` | Logs voix |
| `%LOCALAPPDATA%\com.nico2511.cyberscribenote\` | Préfs WebView / localStorage |

Clés localStorage utiles : `csn-setup-done`, `csn-splash-dismissed` (wizard / splash).

---

## 2. Où on s’est arrêtés (v0.5.4)

### Livré récemment
- **v0.4.1** — durcissement sécurité (XSS Markdown, asset scope, IPC `.md`, écritures atomiques, SSRF, CI, LICENSE) + fiabilité voix
- **v0.5.0** — rename notes, historique SHA256, RAG par vault incrémental, stores Svelte (scaffolding)
- **v0.5.1** — modèle VAD Silero dans `voice_worker` ; build Tauri (pas `cargo` seul)
- **v0.5.2** — stores branchés dans `+page.svelte` (`noteSession`, `voiceSession`, `aiQueue`)
- **v0.5.3** — correctifs packaging zip
- **v0.5.4** — dossiers repliés par défaut, suppression dossiers vides, `.txt` jumeau suit les moves, TXT→MD puis suppression source, wizard Ollama premier lancement
- **v0.5.5** — refactor audit (stores, orchestrateur, 97 Vitest), skill **Indexer dossier** → `sommaire.md`, CI Rust + workflow **release** Windows (zip 2 exe), modules `vault_history` / `voice_cache` / `voice_hotkey`

### Audit initial
P0 / P1 / P2 **terminés**. **P3** en cours : release CI OK ; NSIS / Authenticode / updater / Linux **toujours optionnels** (`bundle.active: false`).

---

## 3. Prochaines actions (priorisées)

### Dette technique (post-refactor audit — état actuel)
1. `+page.svelte` ~900 lignes (orchestration UI) — acceptable ; gros modules dans `src/lib/app/` et stores
2. Tests : Vitest (lib + stores + search) ; pas d’E2E Tauri
3. CI : frontend + Windows smoke + Rust ; **release** sur tag `v*` (build Windows + zip) ; `cargo clippy` informatif
4. Rust : `vault_history`, `voice_cache`, `voice_hotkey`, `voice_util` ; cœur worker encore dans `voice.rs`
5. Valider manuellement migration historique legacy + reindex RAG sur un vrai vault

### Produit (roadmap README / plan)
1. ~~Skill « indexer ce dossier → `sommaire.md` »~~ — skill **Indexer dossier** (companion + voix « indexe dossier »)
2. Templates de notes + graph simple
3. Auto-suggestions plus intelligentes / RAG abouti
4. Bundling NSIS + updater Tauri (+ signature Authenticode)
5. Builds Linux / macOS

### Release — pièges connus
- Toujours `npm run tauri build` (ou `npm run release:win`), **jamais** `cargo build --release` seul → sinon l’exe pointe vers `localhost:1420`
- Zip = **2 fichiers** seulement (`cyberscribe-note.exe` + `voice_worker.exe`)
- Sidecar PyInstaller : garder `collect_data_files` pour assets `faster_whisper` (VAD)

---

## 4. Conversations utiles (Cursor)

- [Cyberscribe audit notes](daafcc5b-2ae3-4a45-816a-18830f04f8ae) — audit → v0.5.4
- [Project audit findings](4c9be735-38d8-4839-85cf-288a66b4a43a) — audit initial
- [Voice worker unresponsive](760ab42c-b6de-41ac-bbfe-1641d2afc9e0) — sidecar / heartbeat

---

## 5. Liens

- Repo : https://github.com/nico2511/CyberScribeNote  
- Releases : https://github.com/nico2511/CyberScribeNote/releases  
- Plan : [CyberScribe_Notes_Plan.md](CyberScribe_Notes_Plan.md)  
- README : [../README.md](../README.md)

*Mis à jour le 11 septembre 2026.*
