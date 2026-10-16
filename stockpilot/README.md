# StockPilot

Application de gestion commerciale (stock, commandes, clients, analytique) dont **toute la logique métier vit dans une base SQLite** : contraintes, triggers, vues et migrations. SQLite tourne dans le navigateur via WebAssembly (sql.js), et la base est persistée dans IndexedDB.

## Lancer

```bash
powershell -ExecutionPolicy Bypass -File stockpilot/serve.ps1
```

Ouvrir ensuite http://localhost:8765 (et http://localhost:8765/tests.html pour les tests).
Aucune installation n'est nécessaire, mais il faut une connexion Internet au premier chargement pour récupérer sql.js depuis cdnjs.

## Architecture

| Fichier | Rôle |
|---|---|
| `js/schema.js` | 3 migrations versionnées (`PRAGMA user_version`) : 8 tables, 8 index, 10 triggers, 5 vues |
| `js/db.js` | Enveloppe de sql.js : requêtes paramétrées, transactions, messages d'erreur lisibles |
| `js/seed.js` | Simulation déterministe de 12 mois d'activité (saisonnalité, tendance, fidélité client) |
| `js/store.js` | Persistance IndexedDB |
| `js/views/*` | Tableau de bord, produits, commandes, saisie de commande, clients, journal, console SQL |
| `js/tests.js` | 18 tests automatisés (schéma, triggers, vues, persistance) |
| `serve.ps1` | Serveur HTTP statique en PowerShell pur |

## Règles métier appliquées par la base

- Le stock n'est jamais modifié directement : chaque variation est un `stock_movement`, et un trigger met le stock à jour.
- Une vente qui rendrait le stock négatif est refusée (`RAISE(ABORT)`) et toute la transaction est annulée.
- Les statuts de commande suivent une machine à états : `pending → paid → shipped`, l'annulation n'est possible qu'avant l'expédition.
- L'annulation d'une commande remet automatiquement les articles en stock.
- Les changements de prix et de statut sont tracés dans `audit_log`.
