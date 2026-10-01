# AchatFlow — Fiche d'Analyse d'Expression de besoin (FAE)

Application web qui digitalise la fiche Excel « FAE » : saisie guidée par l'acheteur, calculs automatiques (devises, savings, effort acheteur), circuit de validation configurable (Acheteur, Manager achats, Directeur opérationnel), alertes e-mail et WhatsApp, tableaux de bord achats et extractions. Multi-clients : chaque entreprise cliente a sa propre fiche, ses listes, son circuit, sa licence.

## Démarrage rapide (sur votre ordinateur)

Prérequis : Node.js 22 ou plus récent.

```
npm install
npm run seed      # crée un client de démonstration (72 FAE fictives)
npm start         # ouvre http://localhost:3000
```

Compte administrateur de démonstration : identifiant `J-Todolist`, mot de passe `1234`. Autres comptes (mot de passe `Demo2026!`) :

| Rôle | Identifiant |
|---|---|
| Acheteur | acheteur@demo.local |
| Manager achats | manager@demo.local |
| Directeur opérationnel | directeur@demo.local |
| Contrôle de gestion (lecture) | controle@demo.local |

Pour la console éditeur (créer des clients et des licences), définissez `SUPERADMIN_EMAIL` et `SUPERADMIN_PASSWORD` avant `npm start`.

## Commandes

| Commande | Effet |
|---|---|
| `npm start` | Démarre le serveur |
| `npm run dev` | Démarre avec rechargement automatique |
| `npm run seed` | Charge le client de démonstration |
| `npm test` | Lance les 19 tests de fumée (base temporaire) |
| `npm run backup` | Sauvegarde la base et les pièces jointes (dossier `data/backups`) |

## Configuration

Toutes les options sont des variables d'environnement, listées et commentées dans `.env.example` (secrets, adresse publique, e-mail SMTP, WhatsApp Meta ou Twilio, compte éditeur).

## Mise en ligne

Voir le guide PDF illustré de mise en ligne. Deux voies sont préparées : Render (`render.yaml`) et un serveur privé (`docker-compose.yml` + `Caddyfile`). La base SQLite et les pièces jointes doivent se trouver sur un disque persistant (`DATA_DIR`).

## Architecture

- `server/` : API Express, SQLite (better-sqlite3), moteur de workflow, alertes, PDF, indicateurs.
- `shared/` : moteur de formules et calculs de la fiche, identiques côté serveur et navigateur.
- `public/` : interface (JavaScript sans étape de compilation).
- `seed/` : nomenclature PSCS et base fournisseurs extraites du fichier Excel d'origine.

## Confidentialité des données de départ

Les fichiers `seed/pscs.json` et `seed/suppliers.json` proviennent du classeur Excel de LafargeHolcim Côte d'Ivoire. Ne les livrez pas à d'autres clients : la console éditeur ne les précharge que sur demande explicite, et chaque client importe ses propres listes (Administration, Autres réglages, Fournisseurs).
