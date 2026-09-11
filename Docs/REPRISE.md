# Point de reprise — CyberScribeNote

**Dernière version publiée :** [v0.5.4](https://github.com/nico2511/CyberScribeNote/releases/tag/v0.5.4) (9 sept. 2026)  
**Branche :** `main` — à jour avec `origin/main`  
**État code :** clean (pas de changements locaux non commités hors zip de release)

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
- Rust (rustup)
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

### Audit initial
P0 / P1 / P2 **terminés**. Il ne reste que du **P3 optionnel** (NSIS, Authenticode, updater, builds Linux, dialogs in-app).

---

## 3. Prochaines actions (priorisées)

### Dette technique (recommandé avant grosses features)
1. Continuer à alléger `src/routes/+page.svelte` (~2100+ lignes) — extraire buddy / Ollama / vault / skills
2. Tests unitaires sur les stores (`noteSession`, `voiceSession`, `aiQueue`)
3. CI : ajouter éventuellement `tauri build` (lourd) ou au moins un job Windows documenté
4. Valider manuellement migration historique legacy + reindex RAG sur un vrai vault

### Produit (roadmap README / plan)
1. Skill « indexer ce dossier → `sommaire.md` »
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
