# CyberScribeNote

Application de prise de notes **100 % locale**, offline-first, avec IA via [Ollama](https://ollama.com) et design pastel minimaliste.

Basé sur le plan [CyberScribe Notes](Docs/CyberScribe_Notes_Plan.md) et inspiré de [CyberScribe](https://github.com/nico2511/CyberScribe) pour la partie vocale.

## Fonctionnalités (v0.2.x)

- Vault Markdown dans `Documents/CyberScribeNote/vault`
- Arborescence dossiers / notes — création, suppression, **glisser-déposer** pour classer
- **Éditeur TipTap WYSIWYG** (Markdown sérialisé) + outline / TOC cliquable, wikilinks `[[Note]]`
- Frontmatter YAML : tags éditables, date `updated` à la sauvegarde
- Thèmes **Light Pastel** et **Dark Pastel** + icônes pixel 16×16
- Recherche rapide **Ctrl+T**
- **Compagnon IA** : suggestions proactives et manuelles (appliquer / ignorer) avec contexte de note
- Correction typo locale automatique (sans déplacer le curseur) + diff des suggestions
- Résumé, reformulation, correction et traduction via Ollama
- **Résumé automatique** opt-in (idle / changement de note)
- RAG local optionnel (`nomic-embed-text` + `rag_index.json`) — Réglages / indexation
- Panneau **Réglages** (Ctrl+,) : Ollama, voix PTT, modèles Whisper
- Images à la position du curseur (`_media/` par note) + redimensionnement
- **Dictée vocale push-to-talk** (hotkey configurable) : worker Python long-lived, heartbeat, arrêt propre à la fermeture
- Commandes vocales (pendant le PTT) : « Scribe, ouvre / cherche / résume / reformule / corrige / traduis »
- Single-instance (une seule fenêtre)
- Export d'une note en `.md`

## Prérequis

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Python 3.10+](https://www.python.org/) (transcription vocale)
- [Ollama](https://ollama.com) (optionnel, pour l'IA / RAG)

### Dépendances vocales (CyberScribe)

```bash
pip install -r voice/requirements.txt
```

Ou via l'app : **Réglages → Voix → Installer dépendances voix**

Les modèles Whisper sont téléchargés dans `Documents/CyberScribeNote/models/`.  
Logs worker : `Documents/CyberScribeNote/voice_worker.log`.

## Démarrage

```bash
npm install
npm run tauri dev
```

## Tests

```bash
npm test
cd src-tauri && cargo test
```

## Build

```bash
npm run tauri build
```

Sortie actuelle : `src-tauri/target/release/cyberscribe-note.exe`  
*(bundle / installateur NSIS volontairement désactivé pour l’instant — `bundle.active: false`.)*

## Troubleshooting

### Voix / « Scribe, … »
1. Réglages → Voix → **Appliquer la config voix**, attendre « Dictée prête ».
2. PTT : hotkey → parler → rappuyer. Les commandes se disent **pendant** l’enregistrement.
3. Note ouverte + non vide pour les actions IA (`corrige`, `résume`…).
4. Si échec : ouvrir `Documents/CyberScribeNote/voice_worker.log` (ligne `Transcription done …`).
5. Heartbeat : toast « Worker vocal sans réponse » → Appliquer la config voix.

### Curseur qui saute
- L’auto-correction ne doit plus trimmer les espaces ni reset le caret.
- Si ça revient : désactiver temporairement « correction auto » dans le Compagnon pour isoler.

### Ollama
- Réglages → démarrer le service / tirer un modèle.
- Pour le RAG : tirer aussi `nomic-embed-text`, puis réindexer.

## Stack

| Couche | Technologie |
|--------|-------------|
| Desktop | Tauri 2 (+ single-instance) |
| Frontend | Svelte 5 + TypeScript + Tailwind CSS 4 + TipTap |
| Backend | Rust (FS vault, Ollama HTTP, RAG) |
| Voix | Python sidecar (faster-whisper), push-to-talk |
| Stockage | Fichiers `.md` + médias locaux |

## Roadmap (plan correctif)

1. **Court terme** — Stabiliser voix / curseur / sidecar / tests / README *(en cours)*
2. **Moyen terme** — Outline + wikilinks + frontmatter + UX erreurs + cross-platform
3. **Phase 2** — RAG embeddings abouti, templates, graph, puis bundling NSIS + updater

Détail : [Docs/CyberScribe_Notes_Plan.md](Docs/CyberScribe_Notes_Plan.md).

## Licence

MIT
