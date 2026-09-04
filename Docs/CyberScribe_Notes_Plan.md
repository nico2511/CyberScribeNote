# CyberScribe Notes – Plan de projet

**Nom provisoire** : CyberScribe Notes (ou PixelScribe / CyberNote)  
**Base existante** : [CyberScribe](https://github.com/nico2511/CyberScribe) – outil de transcription vocale offline (faster-whisper) pour Windows, tray, hotkey globale, auto-paste.

**Vision**  
Application de prise de notes locale, offline-first, propulsée par une IA légère (Llama via Ollama).  
Centré sur la voix comme compagnon, avec un design pastel minimaliste + touche pixel-art.  
Données = fichiers Markdown purs + assets locaux.  
Aucune dépendance cloud obligatoire.

---

## 1. Objectifs principaux (Phase 1 – MVP)

- Gestion de notes en **Markdown** avec hiérarchie de **dossiers**.
- Éditeur riche et agréable.
- Compagnon vocal fort (transcription + commandes par mots-clés).
- IA locale pour : corriger, reformuler, résumer, traduire, suggestions.
- Support d'**images** (insertion, positionnement, redimensionnement).
- Génération automatique de liens de navigation / table des matières (chapitres).
- Thèmes **Light Pastel** et **Dark Pastel** (doux pour les yeux).
- Design minimaliste, coins arrondis, touches pixel-art.
- Panneau de recherche rapide (Ctrl+T / Cmd+T).
- Export Markdown.
- Tout 100 % local.

**Hors scope Phase 1**  
- Partage d'équipe / édition collaborative en live  
- Publication en ligne avancée (Nextcloud, etc. → plus tard)

---

## 2. Stack technique recommandée

| Couche              | Technologie                          | Justification |
|---------------------|--------------------------------------|-------------|
| Shell desktop       | **Tauri 2**                          | Léger, performant, natif, excellent pour hotkeys, tray, fichiers |
| Frontend            | **Svelte 5** + TypeScript            | Simple, réactif, peu de boilerplate |
| Styling             | **Tailwind CSS**                     | Thèmes pastel light/dark ultra-faciles |
| Éditeur Markdown    | **TipTap**                           | Moderne, extensible (images, liens, outline…) |
| IA LLM              | **Ollama** (Llama 3.2 1B/3B, Phi-3, Qwen2.5…) | Local, léger, simple à intégrer |
| Transcription       | **faster-whisper** (existant)        | Déjà présent et offline |
| Embeddings / RAG    | nomic-embed-text (via Ollama)        | Pour suggestions et contexte intelligent |
| Stockage            | Fichiers `.md` + dossier `assets/`   | Interopérable, pas de lock-in |

**Alternative possible** : React à la place de Svelte (plus de ressources communautaires).

---

## 3. Design & Identité visuelle

### Principes
- Minimaliste et aéré
- Coins très arrondis (`rounded-2xl`)
- Ombres très douces
- Touche **pixel-art** : icônes 16×16/24×24, petits accents, indicateurs
- Palette personnalisable (plus tard)

### Thème Light Pastel (par défaut)
- Fond : `#F8F5F2`
- Surfaces : `#FFFFFF` / `#FDF9F6`
- Texte : `#3A3A3A` / secondaire `#7A7A7A`
- Accents : lavande `#C9B1D0`, menthe `#B8D4C8`, bleu doux `#A8C5D4`
- Bordures : `#E8E2DC`

### Thème Dark Pastel (confort yeux)
- Fond : `#1E1C24` / `#25232B`
- Surfaces : `#2C2A35`
- Texte : `#E8E4DF` / secondaire `#A8A4B0`
- Accents : lavande soft, menthe désaturée, bleu pastel
- Bordures : `#3A3845`

### Éléments pixel-art
- Icônes de dossiers, notes, micro, IA, recherche
- Avatar / indicateur du compagnon vocal
- Petits détails décoratifs (bordures, status)

---

## 4. Fonctionnalités détaillées

### Gestion des notes
- Arborescence dossiers / notes
- Création, renommage, suppression, déplacement
- Format Markdown + frontmatter YAML (résumé, tags, date…)
- Export Markdown (note ou vault)

### Éditeur
- Édition Markdown live (TipTap)
- Support images (drag & drop, positionnement, resize)
- Liens internes (`[[Note]]`) + formatage spécifique
- Outline / table des matières automatique (chapitres générés)

### Voix (cœur du projet)
- Hotkey globale + overlay (hérité de CyberScribe)
- Transcription → insertion dans la note active
- **Mots-clés déclencheurs** :  
  « Scribe, résume » · « Scribe, reformule » · « Scribe, corrige » ·  
  « Scribe, traduis en anglais » · « Scribe, ouvre… » · « Scribe, cherche… »
- Mode compagnon (écoute continue optionnelle)

### IA locale
- Résumé automatique une fois la note terminée
- Correction / reformulation / traduction
- Auto-suggestions pendant l'écriture
- Enrichissement du contexte (sélection de notes/dossiers)
- Génération de liens de navigation / chapitres

### Recherche
- **Ctrl + T** (ou Cmd + T) : panneau de recherche rapide  
  (notes, texte, commandes, actions IA)

### Images
- Insertion dans la note
- Positionnement et redimensionnement
- Stockage local dans `assets/`

---

## 5. Roadmap

### Phase 1 – MVP (priorité) — largement en place
1. ~~Structure vault Markdown + dossiers~~
2. ~~Éditeur TipTap de base~~ (+ outline, wikilinks, images)
3. ~~Thèmes Light & Dark Pastel + UI minimaliste + icônes pixel~~
4. ~~Intégration transcription vocale~~ (sidecar long-lived + heartbeat)
5. ~~Mots-clés / commandes vocales de base~~ (« Scribe, … » — à stabiliser en usage réel)
6. ~~Panneau Ctrl+T~~
7. ~~Résumé automatique + premiers prompts IA (Ollama)~~
8. ~~Gestion basique des images~~
9. ~~Export Markdown~~
10. **En cours** : caret stable, tests, single-instance, frontmatter tags/dates, docs

### Stabilisation (court terme)
- Sidecar : heartbeat, shutdown à la fermeture, logs
- Tests unitaires (voice parser, caret, vault path)
- README / troubleshooting
- Pas de bundling NSIS tant que le socle n’est pas figé

### Phase 2 – Enrichissement IA & UX
- Pipeline RAG complet (embeddings Ollama + index local) — amorcé
- Auto-suggestions plus intelligentes
- Outline / wikilinks / frontmatter aboutis
- Templates de notes + graph simple
- Cross-platform (macOS)

### Phase 3 – Distribution & options avancées
- Bundling NSIS + updater Tauri + signature
- Publication (Nextcloud / WebDAV…)
- Partage d'équipe chiffré + édition live (CRDT)
- Plugins / prompts custom

---

## 6. Structure de projet proposée

```
cyberscribe-notes/
├── src-tauri/               # Backend Rust (Tauri)
│   ├── src/
│   │   ├── commands/        # FS, hotkeys, Whisper, Ollama
│   │   └── ...
├── src/                     # Frontend Svelte
│   ├── lib/
│   │   ├── components/      # UI (Sidebar, Editor, SearchPanel, VoiceOverlay…)
│   │   ├── stores/
│   │   ├── themes/          # light.css / dark.css
│   │   └── ai/              # Prompts & Ollama client
│   ├── routes/
│   └── app.css
├── assets/                  # Icônes pixel, sons, etc.
└── README.md
```

---

## 7. Prochaines actions immédiates

1. Valider le nom définitif
2. Créer le repo / initialiser Tauri + Svelte + Tailwind
3. Définir les CSS variables des deux thèmes
4. Implémenter le vault + éditeur de base
5. Brancher Ollama + premiers prompts
6. Réintégrer / adapter la partie vocale de CyberScribe

---

**Philosophie du projet**  
Local • Privé • Vocal • Minimaliste • Doux pour les yeux • Pixel avec élégance

Document généré le 1er septembre 2026.  
Prêt à être affiné selon tes retours.
