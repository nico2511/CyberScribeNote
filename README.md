# CyberScribeNote

Application de prise de notes **100 % locale**, offline-first, avec IA via [Ollama](https://ollama.com) et design pastel minimaliste.

Basé sur le plan [CyberScribe Notes](Docs/CyberScribe_Notes_Plan.md) et inspiré de [CyberScribe](https://github.com/nico2511/CyberScribe) pour la partie vocale.

## Fonctionnalités (v0.2.x)

- Vault Markdown dans `Documents/CyberScribeNote/vault`
- Arborescence dossiers / notes — création, suppression, **glisser-déposer** pour classer
- **Éditeur TipTap WYSIWYG** (Markdown sérialisé) + outline / TOC, wikilinks `[[Note]]`
- Thèmes **Light Pastel** et **Dark Pastel** + icônes pixel 16×16
- Recherche rapide **Ctrl+T**
- **Compagnon IA** : suggestions proactives et manuelles (appliquer / ignorer) avec contexte de note
- Correction typo locale automatique + diff des suggestions
- Résumé, reformulation, correction et traduction via Ollama
- **Résumé automatique** opt-in (idle / changement de note)
- Panneau **Réglages** (Ctrl+,) : Ollama, voix PTT, modèles Whisper
- Images à la position du curseur (`_media/` par note) + redimensionnement
- **Dictée vocale push-to-talk** (hotkey configurable) : worker Python sans fenêtre console
- Commandes vocales : « Scribe, ouvre / cherche / résume / … »
- Export d'une note en `.md`

## Prérequis

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Python 3.10+](https://www.python.org/) (transcription vocale)
- [Ollama](https://ollama.com) (optionnel, pour l'IA)

### Dépendances vocales (CyberScribe)

```bash
pip install -r voice/requirements.txt
```

Ou via l'app : **Réglages → Voix → Installer dépendances voix**

Les modèles Whisper sont téléchargés dans `Documents/CyberScribeNote/models/`.

## Démarrage

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Sortie unique : `src-tauri/target/release/cyberscribe-note.exe` (pas d'installateur MSI/NSIS).

## Stack

| Couche | Technologie |
|--------|-------------|
| Desktop | Tauri 2 |
| Frontend | Svelte 5 + TypeScript + Tailwind CSS 4 + TipTap |
| Backend | Rust (FS vault, Ollama HTTP) |
| Voix | Python sidecar (faster-whisper), push-to-talk |
| Stockage | Fichiers `.md` + médias locaux |

## Roadmap

Voir [Docs/CyberScribe_Notes_Plan.md](Docs/CyberScribe_Notes_Plan.md).

## Licence

MIT
