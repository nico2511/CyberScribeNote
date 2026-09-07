# CyberScribeNote

Application de prise de notes **100 % locale**, offline-first, avec IA via [Ollama](https://ollama.com), compagnon pixel **Scribe**, skills de conception de notes et design pastel minimaliste.

Dépôt : [github.com/nico2511/CyberScribeNote](https://github.com/nico2511/CyberScribeNote)  
Releases : [Releases](https://github.com/nico2511/CyberScribeNote/releases)

Basé sur le plan [CyberScribe Notes](Docs/CyberScribe_Notes_Plan.md) et inspiré de [CyberScribe](https://github.com/nico2511/CyberScribe) pour la partie vocale.

## Fonctionnalités (v0.4.x)

- Vault Markdown configurable (défaut `Documents/CyberScribeNote/vault` — changeable dans Réglages)
- **Sync TXT → MD** : à chaque actualisation du vault, crée une copie `.md` pour chaque `.txt` / `.text` sans jumeau (Nextcloud, etc.) — l’original n’est pas modifié
- Supprimer une note `.md` **supprime aussi** le `.txt` / `.text` jumeau (évite la boucle de recréation)
- **Historique local** des notes (snapshots à la sauvegarde, vue duale actuel / version, restauration) — dossier `.history` masqué
- Arborescence dossiers / notes — création, suppression, **glisser via poignée ⠿**, pastilles de compteur par dossier
- Splash de bienvenue au premier lancement (désactivable)
- **Éditeur TipTap WYSIWYG** + menu contextuel formatage, outline / TOC, wikilinks `[[Note]]`
- Frontmatter YAML : tags, date `updated` à la sauvegarde
- Thèmes **Light Pastel** / **Dark Pastel** + icône app Scribe
- Recherche rapide **Ctrl+T**
- **Compagnon IA** + menu **IA ▾** (résumer / reformuler / corriger / traduire / skills)
- Skills : Structurer, Sommaire, Lien (page / README GitHub), Points clés, Tags, Template, Brief, Plan, Notes liées (RAG), Wikiliens
- **Scribe** : tips + analyse de sélection ; dictée dans le prompt custom
- Correction typo locale + Ollama / RAG optionnel
- Panneau **Réglages** (Ctrl+,) : vault, sync TXT, historique, Ollama, voix (mode sidecar vs Python clair)
- Images à la position du curseur (`_media/` par note)
- **Dictée PTT** : sidecar `voice_worker.exe` (priorité) ou Python
- Single-instance · Export `.md` · Import multi `.txt`

## Téléchargement (Windows)

Sur la [page Releases](https://github.com/nico2511/CyberScribeNote/releases) :

| Asset | Contenu |
|-------|---------|
| **`CyberScribeNote-win.zip`** (recommandé) | `cyberscribe-note.exe` + `voice_worker.exe` — dézipper, lancer l’app |
| `cyberscribe-note.exe` seul | App seule → dictée via **Python** si pas de sidecar à côté |
| `voice_worker.exe` | Sidecar vocal (~190 Mo) à placer **dans le même dossier** que l’app |

- Les **modèles Whisper** se téléchargent au premier usage dans `Documents/CyberScribeNote/models/`.
- Linux / macOS : pas de binaire prêt pour l’instant (build source + Python pour la voix).
- Le worker est local (stdin/stdout, pas de serveur ouvert). Binaire non signé → SmartScreen possible.

## Soutenir / dons

Si le projet vous est utile, vous pouvez soutenir via Bitcoin (BTC) :

```
bc1pt20cczcmvukrny4pru3x2nc522tk2sectlu22d42q2ltyau7t66suh6kqx
```

(Adresse également affichée dans Réglages.)

## Prérequis (dev)

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Python 3.10+](https://www.python.org/) (si pas de sidecar)
- [Ollama](https://ollama.com) (optionnel, IA / RAG)

### Dépendances vocales

**Option A — Sidecar (recommandé pour les utilisateurs)**  
Télécharger le zip de release, ou builder :

```powershell
.\voice\build_sidecar.ps1
```

Produit `voice/voice_worker.exe` (+ copie sous `src-tauri/binaries/`). L’app le préfère à Python.

**Option B — Python (dev)**  
```bash
pip install -r voice/requirements.txt
```
Ou via l’app : **Réglages → Voix → Installer dépendances (pip)** (uniquement en mode Python).

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
*(bundle / installateur NSIS volontairement désactivé — `bundle.active: false`.)*

## Troubleshooting

### Voix / « Scribe, … »
1. Réglages → Voix : vérifier le **mode** (Sidecar .exe ou Python).
2. **Appliquer la config voix**, attendre « Dictée prête » / modèle chargé.
3. PTT : hotkey → parler → rappuyer. Commandes **pendant** l’enregistrement.
4. Prompt custom : focus le champ Compagnon, puis dictez.
5. Si échec : `Documents/CyberScribeNote/voice_worker.log`.

### Sync TXT qui recrée une note
- Supprimer la note **depuis l’app** : le `.txt` jumeau part avec. Sinon le sync recrée le `.md`.

### Glisser-déposer notes
- Poignée **⠿** → déposer sur un dossier (ou « racine »).

### Enrichir un lien GitHub
- Skill **Lien** : README brut via `raw.githubusercontent.com`.

### Ollama
- Réglages → démarrer / tirer un modèle. RAG : aussi `nomic-embed-text`, puis réindexer.

## Stack

| Couche | Technologie |
|--------|-------------|
| Desktop | Tauri 2 (+ single-instance) |
| Frontend | Svelte 5 + TypeScript + Tailwind CSS 4 + TipTap |
| Backend | Rust (FS vault, Ollama HTTP, RAG, fetch web) |
| Voix | Sidecar PyInstaller ou Python (`faster-whisper`), PTT |
| Stockage | Fichiers `.md` + médias + `.history` local |

## Roadmap

1. ~~Vague 1 skills + buddy + enrich liens~~ (v0.3)
2. ~~Sync TXT, historique notes, sidecar vocal clarifié~~ (v0.4)
3. Skill « indexer ce dossier → `sommaire.md` » + templates / graph
4. Bundling NSIS + updater · builds Linux

Détail : [Docs/CyberScribe_Notes_Plan.md](Docs/CyberScribe_Notes_Plan.md).

## Licence

MIT
