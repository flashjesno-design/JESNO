# 📊 Outil Excel VBA - Gestion et Pilotage des Comités Achats

## 📋 Vue d'ensemble

Un outil Excel VBA complet permettant la **gestion, le suivi et le pilotage des Comités Achats**. Cet outil centralise tous les dossiers d'achats, facilite la prise de décision et génère automatiquement les KPI et dashboards pour le management.

**Version :** 1.0  
**Date :** Juin 2026  
**Demandeur :** Direction Achats  
**Utilisateur principal :** Responsable Achats / Secrétaire du Comité Achat

---

## 🎯 Objectifs

### Objectifs Opérationnels
- ✅ Centraliser l'ensemble des dossiers présentés en Comité Achat
- ✅ Réduire le temps de préparation des réunions
- ✅ Assurer la traçabilité des décisions
- ✅ Faciliter le suivi des actions décidées

### Objectifs de Pilotage
- ✅ Mesurer l'activité du Comité Achat
- ✅ Mesurer le respect des processus achats
- ✅ Identifier les sources de dépenses
- ✅ Mesurer les économies réalisées
- ✅ Identifier les risques liés aux achats

---

## 📁 Structure du Fichier Excel

Le classeur comporte **3 feuilles principales** :

```
ComiteAchat_Manager.xlsm
├── 📋 Feuille 1 : FORMULAIRE COMITÉ ACHAT
├── 📊 Feuille 2 : BASE DE DONNÉES (tbl_ComiteAchat)
└── 📈 Feuille 3 : DASHBOARD (KPI + Graphiques)
```

---

## 🔧 Fonctionnalités VBA Implémentées

### 7 Boutons Principaux

| # | Bouton | Fonction |
|---|--------|----------|
| 1 | **Nouveau Dossier** | Effacer tous les champs + Générer nouvel identifiant |
| 2 | **Enregistrer** | Vérifier champs obligatoires + Enregistrement BD |
| 3 | **Rechercher** | Filtrer par Numéro Comité, Date, Fournisseur, Direction |
| 4 | **Modifier** | Mettre à jour l'enregistrement existant |
| 5 | **Supprimer** | Archivage logique + Conservation historique |
| 6 | **Export PDF** | Générer CR_ComiteAchat_YYYYMMDD.pdf |
| 7 | **Actualiser Dashboard** | Rafraîchir TCD, Graphiques, KPI |

---

## 📊 Informations Collectées

### Informations Générales
- Numéro Comité (Automatique)
- Date Comité
- Date de la Demande
- Demandeur, Direction, Département
- Responsable Budget
- Fournisseur Recommandé / Actuel
- Famille Achat, Sous-Famille
- Type Achat, Criticité

### Informations Financières
- Budget Prévisionnel
- Montant Sollicité
- Montant Négocié
- Montant Validé
- **Économie Réalisée** (Montant Sollicité - Montant Validé) ⚡ Automatique

### Processus Achat
- Type de Consultation
- Nombre de Fournisseurs Consultés
- Mise en Concurrence Réalisée
- Dérogation Demandée
- Justification de la Dérogation
- Contrat Existant
- Achat Urgent

### Décision du Comité
- Décision (Validé / Rejeté / En attente)
- Motif
- Responsable Action
- Date Échéance
- Statut Action
- Commentaires

---

## 📈 KPI du Dashboard

### KPI Activité
- **Nombre total de dossiers** : Total présentation
- **Nombre de dossiers validés** : Décision = Validé
- **Nombre de dossiers rejetés** : Décision = Rejeté
- **Taux de validation** : Validés / Présentés

### KPI Financiers
- **Montant total présenté** : Σ Montant Sollicité
- **Montant total validé** : Σ Montant Validé
- **Économies réalisées** : Σ Économie
- **Économie moyenne par dossier** : Économie totale / Nb dossiers

### KPI Process Achat
- **Taux de mise en concurrence** : Dossiers consultés / Total
- **Taux de gré à gré** : Gré à gré / Total
- **Taux de dérogation** : Dérogations / Total
- **Nombre moyen de fournisseurs consultés**

### KPI Risques
- **Taux d'achats urgents** : Urgents / Total
- **Nombre de dossiers critiques** : Criticité = Critique
- **Nombre de fournisseurs uniques** : Distinct

### KPI Suivi des Actions
- **Actions ouvertes** : Statut ≠ Clôturé
- **Actions clôturées** : Statut = Clôturé
- **Actions en retard** : Date échéance < Aujourd'hui
- **Taux de clôture** : Clôturées / Totales

---

## 📊 Graphiques du Dashboard

1. **Evolution mensuelle des montants validés** (Courbe)
2. **Répartition par famille achat** (Histogramme)
3. **Répartition CAPEX / OPEX** (Camembert)
4. **Top 10 fournisseurs** (Histogramme)
5. **Répartition des décisions** (Camembert)
6. **Dérogations par direction** (Histogramme)
7. **Achats urgents par mois** (Courbe)
8. **Actions en retard** (Histogramme)

---

## 🎛️ Filtres du Dashboard (Segments Excel)

- Année
- Mois
- Trimestre
- Direction
- Département
- Fournisseur
- Famille Achat
- Sous-Famille
- Criticité
- Décision

---

## 📋 Règles de Gestion

| ID | Règle |
|----|-------|
| **RG01** | Chaque dossier doit avoir un identifiant unique |
| **RG02** | Champs obligatoires : Date Comité, Demandeur, Direction, Fournisseur, Famille Achat, Montant Sollicité, Décision |
| **RG03** | L'économie est calculée automatiquement |
| **RG04** | Toute modification doit conserver l'historique |
| **RG05** | Les tableaux de bord doivent se mettre à jour automatiquement |

---

## 📦 Structure des Fichiers du Projet

```
ComiteAchat-Tool/
├── 📘 README.md (ce fichier)
├── 📗 GUIDE_UTILISATEUR.md
├── 📙 SPECIFICATIONS_TECHNIQUES.md
├── 📕 REGLES_METIER.md
├── 📓 VBA_MODULES/
│   ├── ModuleFormulaire.bas
│   ├── ModuleBaseDonnees.bas
│   ├── ModuleKPI.bas
│   ├── ModulePDF.bas
│   ├── ModuleValidation.bas
│   └── ModuleUtilitaires.bas
├── 📊 ComiteAchat_Manager.xlsm (Fichier principal)
└── 📋 CHANGELOG.md
```

---

## 🚀 Installation & Utilisation

### Prérequis
- Microsoft Excel 2016 ou supérieur (Windows ou Mac)
- Macros activées
- Accès en lecture/écriture sur le fichier
- Imprimante ou enregistrement PDF pour les exports

### Étapes d'installation

1. **Télécharger** le fichier `ComiteAchat_Manager.xlsm`
2. **Placer** le fichier dans votre dossier Documents ou réseau
3. **Ouvrir** le fichier dans Excel
4. **Accepter** l'activation des macros (si demandé)
5. **Commencer** à utiliser le formulaire

---

## 📖 Documentation Complète

- 📗 **[GUIDE_UTILISATEUR.md](./GUIDE_UTILISATEUR.md)** - Guide pas à pas pour les utilisateurs
- 📙 **[SPECIFICATIONS_TECHNIQUES.md](./SPECIFICATIONS_TECHNIQUES.md)** - Architecture VBA détaillée
- 📕 **[REGLES_METIER.md](./REGLES_METIER.md)** - Règles et validations métier

---

## 👥 Support & Contact

- **Propriétaire du projet :** Direction Achats
- **Développeur :** Équipe IT
- **Date de création :** Juin 2026
- **Version actuelle :** 1.0

---

## 📝 Licence

Propriété interne - Tous droits réservés

---

**Dernière mise à jour :** Juin 2026
