'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'pt' | 'es' | 'de';

const translations = {
  en: {
    'nav.analysis': '3. Analysis',
    'nav.findPage': 'Find a page',
    'nav.noResults': 'No matching pages',
    'nav.skipContent': 'Skip to content',
    'nav.howItWorks': 'How it works',
    'nav.thesis': '1. Thesis',
    'nav.discover': '2. Discover',
    'nav.portfolio': '4. Portfolio',
    'nav.researchHistory': 'Research history',
    'nav.aiFeed': 'AI Feed',
    'nav.decisionLog': 'Decision Log',
    'nav.candidateRecords': 'Candidate records',
    'nav.portfolioReview': 'Portfolio Review',
    'nav.investmentReview': 'Investment Review',
    'nav.researchInbox': 'Research & Analysis Inbox',
    'nav.investmentControl': 'Investment Control',
    'nav.researchOperations': 'Research Operations',
    'nav.adminPanel': 'Admin',
    'nav.settings': 'Settings',
    'nav.agentSettings': 'Agent settings',
    'nav.securities': 'Securities',
    'nav.accountSecurity': 'Account Security',
    'nav.more': 'More',
    'nav.menu': 'Menu',
    'nav.close': 'Close',
    'nav.mainNavigation': 'Main navigation',
    'actions.toggleTheme': 'Toggle theme',
    'actions.dark': 'Dark',
    'actions.light': 'Light',
    'actions.signingOut': 'Signing out…',
    'actions.retrySignOut': 'Retry sign out',
    'actions.signOut': 'Sign out',
    'account.activeClient': 'Active client account',
    'language.label': 'Language',
    'language.translationUnavailable': 'Automatic translation is unavailable; showing built-in translations.',
    'portfolio.viewing': 'Viewing',
    'portfolio.noneSelected': 'No portfolio selected',
  },
  pt: {
    'nav.analysis': '3. Análise',
    'nav.findPage': 'Encontrar página',
    'nav.noResults': 'Nenhuma página encontrada',
    'nav.skipContent': 'Ir para o conteúdo',
    'nav.howItWorks': 'Como funciona',
    'nav.thesis': '1. Tese',
    'nav.discover': '2. Descobrir',
    'nav.portfolio': '4. Portfólio',
    'nav.researchHistory': 'Histórico de pesquisas',
    'nav.aiFeed': 'Feed de IA',
    'nav.decisionLog': 'Registro de decisões',
    'nav.candidateRecords': 'Ativos candidatos',
    'nav.portfolioReview': 'Revisão do portfólio',
    'nav.investmentReview': 'Revisão de investimentos',
    'nav.researchInbox': 'Caixa de pesquisa e análise',
    'nav.investmentControl': 'Controles de investimento',
    'nav.researchOperations': 'Operações de pesquisa',
    'nav.adminPanel': 'Administração',
    'nav.settings': 'Configurações',
    'nav.agentSettings': 'Configurações dos agentes',
    'nav.securities': 'Ativos',
    'nav.accountSecurity': 'Segurança da conta',
    'nav.more': 'Mais',
    'nav.menu': 'Menu',
    'nav.close': 'Fechar',
    'nav.mainNavigation': 'Navegação principal',
    'actions.toggleTheme': 'Alternar tema',
    'actions.dark': 'Escuro',
    'actions.light': 'Claro',
    'actions.signingOut': 'Saindo…',
    'actions.retrySignOut': 'Tentar sair novamente',
    'actions.signOut': 'Sair',
    'account.activeClient': 'Conta de cliente ativa',
    'language.label': 'Idioma',
    'language.translationUnavailable': 'A tradução automática está indisponível; exibindo traduções integradas.',
    'portfolio.viewing': 'Visualizando',
    'portfolio.noneSelected': 'Nenhum portfólio selecionado',
  },
  es: {
    'nav.analysis': '3. Análisis',
    'nav.findPage': 'Buscar página',
    'nav.noResults': 'No hay páginas coincidentes',
    'nav.skipContent': 'Saltar al contenido',
    'nav.howItWorks': 'Cómo funciona',
    'nav.thesis': '1. Tesis',
    'nav.discover': '2. Descubrir',
    'nav.portfolio': '4. Cartera',
    'nav.researchHistory': 'Historial de análisis',
    'nav.aiFeed': 'Feed de IA',
    'nav.decisionLog': 'Registro de decisiones',
    'nav.candidateRecords': 'Activos candidatos',
    'nav.portfolioReview': 'Revisión de la cartera',
    'nav.investmentReview': 'Revisión de inversiones',
    'nav.researchInbox': 'Bandeja de investigación y análisis',
    'nav.investmentControl': 'Control de inversiones',
    'nav.researchOperations': 'Operaciones de investigación',
    'nav.adminPanel': 'Administración',
    'nav.settings': 'Configuración',
    'nav.agentSettings': 'Configuración de agentes',
    'nav.securities': 'Valores',
    'nav.accountSecurity': 'Seguridad de la cuenta',
    'nav.more': 'Más',
    'nav.menu': 'Menú',
    'nav.close': 'Cerrar',
    'nav.mainNavigation': 'Navegación principal',
    'actions.toggleTheme': 'Cambiar tema',
    'actions.dark': 'Oscuro',
    'actions.light': 'Claro',
    'actions.signingOut': 'Cerrando sesión…',
    'actions.retrySignOut': 'Reintentar cierre',
    'actions.signOut': 'Cerrar sesión',
    'account.activeClient': 'Cuenta de cliente activa',
    'language.label': 'Idioma',
    'language.translationUnavailable': 'La traducción automática no está disponible; se muestran las traducciones integradas.',
    'portfolio.viewing': 'Viendo',
    'portfolio.noneSelected': 'Ninguna cartera seleccionada',
  },
  de: {
    'nav.analysis': '3. Analyse',
    'nav.findPage': 'Seite finden',
    'nav.noResults': 'Keine passenden Seiten',
    'nav.skipContent': 'Zum Inhalt springen',
    'nav.howItWorks': 'So funktioniert es',
    'nav.thesis': '1. These',
    'nav.discover': '2. Entdecken',
    'nav.portfolio': '4. Portfolio',
    'nav.researchHistory': 'Research-Verlauf',
    'nav.aiFeed': 'KI-Feed',
    'nav.decisionLog': 'Entscheidungsprotokoll',
    'nav.candidateRecords': 'Anlagekandidaten',
    'nav.portfolioReview': 'Portfolioüberprüfung',
    'nav.investmentReview': 'Anlageprüfung',
    'nav.researchInbox': 'Research- und Analyse-Posteingang',
    'nav.investmentControl': 'Anlagekontrolle',
    'nav.researchOperations': 'Research-Betrieb',
    'nav.adminPanel': 'Verwaltung',
    'nav.settings': 'Einstellungen',
    'nav.agentSettings': 'Agenten-Einstellungen',
    'nav.securities': 'Wertpapiere',
    'nav.accountSecurity': 'Kontosicherheit',
    'nav.more': 'Mehr',
    'nav.menu': 'Menü',
    'nav.close': 'Schließen',
    'nav.mainNavigation': 'Hauptnavigation',
    'actions.toggleTheme': 'Darstellung wechseln',
    'actions.dark': 'Dunkel',
    'actions.light': 'Hell',
    'actions.signingOut': 'Abmeldung läuft…',
    'actions.retrySignOut': 'Abmeldung wiederholen',
    'actions.signOut': 'Abmelden',
    'account.activeClient': 'Aktives Kundenkonto',
    'language.label': 'Sprache',
    'language.translationUnavailable': 'Automatische Übersetzung nicht verfügbar; integrierte Übersetzungen werden angezeigt.',
    'portfolio.viewing': 'Ansicht',
    'portfolio.noneSelected': 'Kein Portfolio ausgewählt',
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  translationUnavailable: boolean;
  setTranslationUnavailable: (unavailable: boolean) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = 'portfolio-intelligence-language';

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'pt' || value === 'es' || value === 'de';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [translationUnavailable, setTranslationUnavailable] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const browserLanguage = window.navigator.language.slice(0, 2);
    const initial = isLanguage(stored) ? stored : isLanguage(browserLanguage) ? browserLanguage : 'en';
    setLanguageState(initial);
    document.documentElement.lang = initial === 'pt' ? 'pt-BR' : initial;
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    setTranslationUnavailable(false);
    document.documentElement.lang = next === 'pt' ? 'pt-BR' : next;
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    translationUnavailable,
    setTranslationUnavailable,
    t: (key) => translations[language][key],
  }), [language, translationUnavailable]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
