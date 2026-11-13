/**
 * French translations for MediChain (Phase 3.5 — starter set).
 * Missing keys fall back to en-US via the I18nProvider's deep merge.
 */

import type { TranslationRecord } from '../index';

const fr_FR: TranslationRecord = {
  common: {
    // France: 15 SAMU, 112 Europe-wide.
    emergencyNumber: '15',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    add: 'Ajouter',
    remove: 'Retirer',
    search: 'Rechercher',
    filter: 'Filtrer',
    loading: 'Chargement...',
    saveFailed: "Échec de l'enregistrement. La fiche n'a pas été enregistrée — veuillez réessayer.",
    error: 'Erreur',
    success: 'Succès',
    warning: 'Avertissement',
    info: 'Information',
    confirm: 'Confirmer',
    back: 'Retour',
    next: 'Suivant',
    previous: 'Précédent',
    submit: 'Soumettre',
    close: 'Fermer',
    yes: 'Oui',
    no: 'Non',
    ok: 'OK',
    required: 'Requis',
    optional: 'Facultatif',
    noData: 'Aucune donnée disponible',
    viewAll: 'Tout voir',
    refresh: 'Actualiser',
    logout: 'Déconnexion',
    login: 'Connexion',
    signUp: "S'inscrire",
  },
  auth: {
    welcomeTitle: 'Bienvenue sur MediChain',
    connecting: 'Connexion...',
    signInNfc: 'Se connecter avec une carte NFC',
    scanQr: 'Scanner le code QR',
  },
  emergency: {
    title: "Carte médicale d'urgence",
    bloodType: 'Groupe sanguin',
    allergiesWarning: 'Allergies critiques',
    conditions: 'Affections actives',
    currentMedications: 'Médicaments actuels',
    emergencyContacts: "Contacts d'urgence",
    cardTitle: "Carte d'urgence",
    cardSubtitle: "Scanner pour l'accès médical d'urgence",
    offlineNotice: 'Hors ligne — affichage de votre copie enregistrée.',
    nationalHealthId: 'Identifiant national de santé',
    share: 'Partager',
    dob: 'Naissance',
    nfcReady: 'Carte NFC prête',
    nfcTapHint: 'Touchez votre carte pour un accès instantané',
    nfcInfo: "Les soignants peuvent toucher leur lecteur NFC pour accéder instantanément à vos données médicales d'urgence.",
    criticalInfo: 'Informations médicales critiques',
    allergies: 'Allergies',
    chronicConditions: 'Affections chroniques',
    notDonor: 'Pas donneur',
    dnrOrder: 'Ordre de non-réanimation',
    fullResuscitation: 'Réanimation complète',
    emergencyContact: "Contact d'urgence",
    call: 'Appeler',
    cardHash: 'Empreinte de la carte',
    lastUpdated: 'Dernière mise à jour',
  },
};

export default fr_FR;
