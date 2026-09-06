# CyberScribeNote

Application de prise de notes **100 % locale**, offline-first, avec IA via [Ollama](https://ollama.com), compagnon pixel **Scribe**, skills de conception de notes et design pastel minimaliste.

Dépôt : [github.com/nico2511/CyberScribeNote](https://github.com/nico2511/CyberScribeNote)

Basé sur le plan [CyberScribe Notes](Docs/CyberScribe_Notes_Plan.md) et inspiré de [CyberScribe](https://github.com/nico2511/CyberScribe) pour la partie vocale.

## Fonctionnalités (v0.3.x)

- Vault Markdown configurable (défaut `Documents/CyberScribeNote/vault` — changeable dans Réglages)
- Arborescence dossiers / notes — création, suppression, **glisser-déposer** (poignée ⠿) pour classer
- **Éditeur TipTap WYSIWYG** (Markdown sérialisé) + outline / TOC cliquable, wikilinks `[[Note]]`
- Frontmatter YAML : tags (skill Tags), date `updated` à la sauvegarde
- Thèmes **Light Pastel** et **Dark Pastel** + icône app Scribe pixel
- Recherche rapide **Ctrl+T**
- **Compagnon IA** : prompt custom (dictée PTT dans le champ), skills groupées, suggestions appliquer / ignorer
- Skills Vague 1 : Structurer, Sommaire, Lien (fetch page / README GitHub), Points clés, Tags, Template, Brief, Plan, Notes liées (RAG), Wikiliens
- **Scribe** (buddy pixel) : tips contextuels (lien seul, fences, notes liées…)
- Correction typo locale + résumé / reformulation / traduction via Ollama
- RAG local optionnel (`nomic-embed-text`) — Réglages / indexation
- Panneau **Réglages** (Ctrl+,) : vault, Ollama, voix PTT, modèles Whisper
- Images à la position du curseur (`_media/` par note)
- **Dictée vocale push-to-talk** + commandes « Scribe, … » (skills incluses)
- Single-instance · Export `.md`

## Soutenir / dons

Si le projet vous est utile, vous pouvez soutenir via Bitcoin (BTC) :

```
bc1pt20cczcmvukrny4pru3x2nc522tk2sectlu22d42q2ltyau7t66suh6kqx
```

(Adresse également affichée dans Réglages.)

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

Sortie : `src-tauri/target/release/cyberscribe-note.exe`  
*(bundle / installateur NSIS volontairement désactivé pour l’instant — `bundle.active: false`.)*

## Troubleshooting

### Voix / « Scribe, … »
1. Réglages → Voix → **Appliquer la config voix**, attendre « Dictée prête ».
2. PTT : hotkey → parler → rappuyer. Les commandes se disent **pendant** l’enregistrement.
3. Prompt custom : focus le champ dans le Compagnon, puis dictez (insertion dans le prompt).
4. Note ouverte + non vide pour les actions IA (`corrige`, `résume`…).
5. Si échec : ouvrir `Documents/CyberScribeNote/voice_worker.log`.

### Glisser-déposer notes
- Utilisez la poignée **⠿** à gauche de la note / du dossier, déposez sur un dossier (ou « racine »).

### Enrichir un lien GitHub
- Skill **Lien** : récupère le README brut (`raw.githubusercontent.com`) quand c’est un dépôt GitHub.

### Ollama
- Réglages → démarrer le service / tirer un modèle.
- Pour le RAG : tirer aussi `nomic-embed-text`, puis réindexer.

## Stack

| Couche | Technologie |
|--------|-------------|
| Desktop | Tauri 2 (+ single-instance) |
| Frontend | Svelte 5 + TypeScript + Tailwind CSS 4 + TipTap |
| Backend | Rust (FS vault, Ollama HTTP, RAG, fetch web) |
| Voix | Python sidecar (faster-whisper), push-to-talk |
| Stockage | Fichiers `.md` + médias locaux |

## Roadmap

1. ~~Vague 1 skills + buddy + enrich liens~~ (v0.3)
2. Templates / résumé multi-niveaux affinés, graph de notes
3. Bundling NSIS + updater

Détail : [Docs/CyberScribe_Notes_Plan.md](Docs/CyberScribe_Notes_Plan.md).

## Licence

MIT
