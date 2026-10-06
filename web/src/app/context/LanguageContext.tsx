'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'es' | 'en';

interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  es: {
    // General
    'app.title': 'OmniCapital',
    'app.subtitle': 'Plataforma de Gestión Patrimonial V3.1',
    'app.loading': 'Cargando Terminal...',
    'auth.email': 'Correo Electrónico',
    'auth.password': 'Contraseña',
    'auth.login': 'Ingresar a la Terminal',
    'auth.logging_in': 'Autenticando...',
    'header.logout': 'SALIR',
    // Login
    'login.email_confirmation': 'Revisa tu correo para confirmar tu cuenta. Si no configuraste confirmación, ya puedes iniciar sesión.',
    'login.error_auth': 'Error de autenticación',
    'login.welcome': 'Plataforma de Gestión Patrimonial',
    'login.button': 'Ingresar',
    'login.register_button': 'Crear Cuenta',
    'login.demo': 'Modo demo',
    'login.cartola': 'Probar Extractor (Sin Login)',
    // Tabs
    'tab.data_warehouse': '[00] BASE DE DATOS',
    'tab.portfolio': '[01] MI PORTAFOLIO',
    'tab.recommendations': '[02] INTELIGENCIA',
    'tab.screener': '[03] BUSCADOR',
    'tab.top5': '[04] TOP OPORTUNIDADES',
    'tab.calculator': '[05] CALCULADORA',
    'tab.dividends': '[06] DIVIDENDOS',
    'tab.backtest': '[07] SIMULADOR',
  },
  en: {
    // General
    'app.title': 'OmniCapital',
    'app.subtitle': 'Wealth Management Platform V3.1',
    'app.loading': 'Loading Terminal...',
    'auth.email': 'Email Address',
    'auth.password': 'Password',
    'auth.login': 'Access Terminal',
    'auth.logging_in': 'Authenticating...',
    'header.logout': 'LOGOUT',
    // Login
    'login.email_confirmation': 'Check your email to confirm your account. If no confirmation is required, you may log in.',
    'login.error_auth': 'Authentication Error',
    'login.welcome': 'Wealth Management Platform',
    'login.button': 'Sign In',
    'login.register_button': 'Create Account',
    'login.demo': 'Demo mode',
    'login.cartola': 'Test Extractor (No Login)',
    // Tabs
    'tab.data_warehouse': '[00] DATA WAREHOUSE',
    'tab.portfolio': '[01] MY PORTFOLIO',
    'tab.recommendations': '[02] INTELLIGENCE',
    'tab.screener': '[03] SCREENER',
    'tab.top5': '[04] TOP OPPORTUNITIES',
    'tab.calculator': '[05] CALCULATOR',
    'tab.dividends': '[06] DIVIDENDS',
    'tab.backtest': '[07] BACKTEST',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('es');

  useEffect(() => {
    // Se lee después de hidratar (localStorage no existe en el servidor)
    const saved = localStorage.getItem('omnicapital_lang');
    if (saved === 'es' || saved === 'en') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLanguage(saved);
    }
  }, []);

  const toggleLanguage = () => {
    setLanguage(prev => {
      const next = prev === 'es' ? 'en' : 'es';
      localStorage.setItem('omnicapital_lang', next);
      return next;
    });
  };

  const t = (key: string): string => {
    return translations[language][key] || translations.es[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
