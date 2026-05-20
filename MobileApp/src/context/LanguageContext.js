import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LanguageContext = createContext();

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState('en'); // 'en' for English, 'tl' for Tagalog

  useEffect(() => {
    // Load language preference from storage
    loadLanguagePreference();
  }, []);

  const loadLanguagePreference = async () => {
    try {
      const savedLanguage = await AsyncStorage.getItem('language');
      if (savedLanguage !== null) {
        setLanguage(savedLanguage);
      }
    } catch (error) {
      // Silent error handling - will use default (English)
    }
  };

  const changeLanguage = async (lang) => {
    try {
      setLanguage(lang);
      await AsyncStorage.setItem('language', lang);
    } catch (error) {
      // Silent error handling - language change may not persist
    }
  };

  const value = {
    language,
    changeLanguage,
    isEnglish: language === 'en',
    isTagalog: language === 'tl',
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

