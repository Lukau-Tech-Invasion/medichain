/**
 * Swahili translations for MediChain (Phase 3.5 — starter set).
 * Missing keys fall back to en-US via the I18nProvider's deep merge.
 */

import type { TranslationRecord } from '../index';

const sw_KE: TranslationRecord = {
  common: {
    // Kenya: 999, or 112 from any mobile.
    emergencyNumber: '999',
    save: 'Hifadhi',
    cancel: 'Ghairi',
    delete: 'Futa',
    edit: 'Hariri',
    add: 'Ongeza',
    remove: 'Ondoa',
    search: 'Tafuta',
    filter: 'Chuja',
    loading: 'Inapakia...',
    saveFailed: 'Imeshindwa kuhifadhi. Rekodi haikuhifadhiwa — tafadhali jaribu tena.',
    error: 'Hitilafu',
    success: 'Imefanikiwa',
    warning: 'Onyo',
    info: 'Taarifa',
    confirm: 'Thibitisha',
    back: 'Rudi',
    next: 'Endelea',
    previous: 'Iliyotangulia',
    submit: 'Wasilisha',
    close: 'Funga',
    yes: 'Ndiyo',
    no: 'Hapana',
    ok: 'Sawa',
    required: 'Inahitajika',
    optional: 'Si lazima',
    noData: 'Hakuna data',
    viewAll: 'Ona zote',
    refresh: 'Onyesha upya',
    logout: 'Toka',
    login: 'Ingia',
    signUp: 'Jisajili',
  },
  auth: {
    welcomeTitle: 'Karibu MediChain',
    connecting: 'Inaunganisha...',
    signInNfc: 'Ingia kwa kadi ya NFC',
    scanQr: 'Changanua msimbo wa QR',
  },
  emergency: {
    title: 'Kadi ya Dharura ya Matibabu',
    bloodType: 'Aina ya damu',
    allergiesWarning: 'Mzio hatari',
    conditions: 'Magonjwa yanayoendelea',
    currentMedications: 'Dawa za sasa',
    emergencyContacts: 'Mawasiliano ya dharura',
    cardTitle: 'Kadi ya Dharura',
    cardSubtitle: 'Changanua kwa ufikiaji wa matibabu ya dharura',
    offlineNotice: 'Nje ya mtandao — inaonyesha nakala yako iliyohifadhiwa.',
    nationalHealthId: 'Kitambulisho cha Kitaifa cha Afya',
    share: 'Shiriki',
    dob: 'Tarehe ya kuzaliwa',
    nfcReady: 'Kadi ya NFC iko tayari',
    nfcTapHint: 'Gusa kadi yako kwa ufikiaji wa papo hapo',
    nfcInfo: 'Watoa huduma wanaweza kugusa kisomaji chao cha NFC kufikia data yako ya dharura mara moja.',
    criticalInfo: 'Taarifa muhimu za matibabu',
    allergies: 'Mzio',
    chronicConditions: 'Magonjwa sugu',
    notDonor: 'Si mchangiaji',
    dnrOrder: 'Agizo la kutofufua',
    fullResuscitation: 'Ufufuaji kamili',
    emergencyContact: 'Mawasiliano ya dharura',
    call: 'Piga simu',
    cardHash: 'Nambari ya kadi',
    lastUpdated: 'Imesasishwa mwisho',
  },
};

export default sw_KE;
