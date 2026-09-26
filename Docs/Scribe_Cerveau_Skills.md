# Cerveau Scribe — skills combinables

Scribe (le pixel, `scribeBuddy.ts`) est le cerveau **visible**, hors du menu IA ▾ : tips, raccourcis, plans. Le **routeur** (`src/lib/ai/skillRouter.ts`) est le moteur : une consigne libre devient un plan de 1 à N skills, dans l’ordre, avec une confiance et un pourquoi.

Le menu IA ▾ reste le geste unitaire (résumer, reformuler, corriger, traduire, un skill). Le cerveau sert à **enchaîner** un flux de note.

Tout reste offline-first. Ollama est local. Aucune API cloud.

## Thèmes

Chaque skill du catalogue TypeScript porte un `theme`. Le `group` (`shape` | `write` | `connect`) continue d’alimenter le menu.

| Thème | Rôle | Skills |
| --- | --- | --- |
| `prise-de-notes` | Démarrer une note | Template |
| `analyse` | Extraire | Points clés, Actions, Questions, Décisions |
| `ecriture` | Rédiger | Brief, Clarifier, Raccourcir |
| `construction` | Bâtir la forme | Plan, Sommaire, Titre |
| `amelioration` | Réparer sans changer le fond | Structurer, Relire |
| `documents` | Source externe ou dossier | Lien, Indexer dossier, Sources |
| `connexion` | Classer et relier le vault | Tags, Liées, [[Liens]] |

« Lien » va chercher une page. « Sources » liste seulement les URL déjà écrites, sans réseau. « Brief » reste le résumé court ; Clarifier et Raccourcir réécrivent les mêmes faits.

## Combinabilité

`routeSkillsFromIntent(input)` lit :

- le texte libre ou le transcript ;
- un extrait de note optionnel (utilisé seulement si la consigne est vide ou vague) ;
- des drapeaux : `hasSelection`, `hasUrl`, `hasRelated`, `docImported`.

Retour : `SkillRoutePlan` ou `null`.

| Champ | Sens |
| --- | --- |
| `skills` | `SkillId[]` dans l’ordre d’exécution (v1 : 4 max) |
| `themes` | thèmes distincts, dans le même ordre |
| `confidence` | 0–1 |
| `why` | phrase française |
| `source` | `"rules"` ou `"llm"` |
| `steps` | détail par skill (`RoutedSkill` : id, thème, confiance, pourquoi) |

Exemples de règles :

- « analyse ce CR » → Points clés, Brief, Tags.
- « analyse ce CR et les décisions » → Points clés, Décisions, Brief, Tags.
- « analyse les actions de ce CR » → Points clés, Actions, Brief, Tags.
- « clarifie et raccourcis » → Clarifier, puis Raccourcir.
- « construis cette note et ajoute des tags » → Plan, Sommaire, Tags.
- « relie cette note » → Liées, puis Wikiliens.
- document importé → Structurer, Points clés, Tags. S'il contient déjà une URL : Structurer, Sources, Points clés, Tags.
- commande courte (`sommaire`, `relis`, `sources`, ≤ 4 mots) → un seul skill, comme `matchSkillFromText`. « Scribe, corrige » reste la commande IA corriger ; Relire se lance par « relis », « orthographe » ou le menu.

`combineSkillPlan(plan)` décrit le plan pour l’UI : « Je lance Points clés, Brief puis Tags. »

Le texte long n’est plus bloqué par le plafond de 4 mots de `matchSkillFromText`. Ce plafond reste en place pour la commande vocale unitaire. La voix n’appelle le routeur que si la phrase **s’ouvre** comme une commande (« analyse… », « fais un sommaire… »), pour laisser passer la dictée.

## Format skill (Markdown, plus tard)

v1 garde le catalogue TypeScript (`NOTE_SKILLS`). Le format cible, pour un bundle ou le vault, est un fichier `.md` :

```markdown
---
id: keypoints
label: Points clés
theme: analyse
group: write
needsLlm: true
applyMode: append
voice: "points cles|keypoints|checklist"
---

Extrais de CETTE note uniquement :
1) ## Points clés — puces déjà présentes
2) ## Tâches — checklist des actions déjà mentionnées
```

Le corps devient `llmInstruction` (ou la doc d’une skill locale). Un chargeur futur fusionne par `id` :

1. vault `.scribe/skills/*.md` (prioritaire) ;
2. skills bundlées avec l’app ;
3. catalogue TypeScript, filet de sécurité.

Même `SkillId`, mêmes thèmes, même plan. v1 ne lit pas encore ces fichiers.

## Secours si Ollama est arrêté

1. Le routeur v1 est **déterministe** (`source: "rules"`). Il ne contacte pas Ollama.
2. Crochet optionnel `classify` (synchrone). S’il lance, renvoie `null`, ou une confiance plus basse, le plan règles reste.
3. Les skills `needsLlm: false` passent par `runSkillLocal` (sommaire, template, wikiliens, liées, réparation locale).
4. Scribe propose encore un tip sans routeur texte : note vide, fence ouverte, lien seul, ou note longue sans brief ni tags (plan d’analyse).

Lancer un plan ouvre le compagnon et enchaîne les skills. Chacune reste une **suggestion** à appliquer ou ignorer. Rien n’est écrit dans la note tout seul.

## Hors sujet

- Pas d’API cloud, pas de nouveau fournisseur de modèle.
- Pas de remplacement de l’éditeur TipTap.
- Pas de réécriture du menu IA ▾ ni de `+page.svelte` au-delà du branchement du plan.
- Pas d’exécution silencieuse d’un pipeline LLM sans clic ou commande explicite.
- Pas de skills Markdown chargées dans cette version.

Détail produit : [CyberScribe_Notes_Plan.md](CyberScribe_Notes_Plan.md), phase 2.
