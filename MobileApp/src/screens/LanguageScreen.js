import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/ui/Header';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const translations = {
  en: {
    title: 'Language',
    subtitle: 'Select your preferred language',
    english: 'English',
    tagalog: 'Tagalog (Filipino)',
    current: 'Current',
  },
  tl: {
    title: 'Wika',
    subtitle: 'Piliin ang iyong preferred language',
    english: 'English',
    tagalog: 'Tagalog (Filipino)',
    current: 'Kasalukuyan',
  },
};

const languages = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog (Filipino)' },
];

export default function LanguageScreen({ navigation }) {
  const { colors } = useTheme();
  const { language, changeLanguage } = useLanguage();
  const t = translations[language];
  const dynamicStyles = getDynamicStyles(colors);

  const handleLanguageSelect = (langCode) => {
    changeLanguage(langCode);
    // Optionally navigate back after selection
    setTimeout(() => {
      navigation.goBack();
    }, 300);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t.title} />
      <View style={styles.content}>
        <Text style={[dynamicStyles.subtitle, { color: colors.textSecondary }]}>{t.subtitle}</Text>
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {languages.map((lang, index) => {
            const isSelected = language === lang.code;
            return (
              <View key={lang.code}>
                <TouchableOpacity
                  style={styles.languageItem}
                  onPress={() => handleLanguageSelect(lang.code)}
                  activeOpacity={0.7}
                >
                  <View style={styles.languageContent}>
                    <Text style={[dynamicStyles.languageName, { color: colors.textPrimary }]}>
                      {lang.nativeName}
                    </Text>
                    {isSelected && (
                      <View style={[styles.currentBadge, { backgroundColor: colors.primary + '20' }]}>
                        <Text style={[dynamicStyles.currentText, { color: colors.primary }]}>
                          {t.current}
                        </Text>
                      </View>
                    )}
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                  )}
                  {!isSelected && (
                    <Ionicons name="ellipse-outline" size={24} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
                {index < languages.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
                )}
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

function getDynamicStyles(colors) {
  return StyleSheet.create({
    subtitle: {
      fontSize: 14,
      marginBottom: 8,
    },
    languageName: {
      fontSize: 16,
      fontWeight: '600',
    },
    currentText: {
      fontSize: 12,
      fontWeight: '600',
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  spacing: {
    height: 12,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  languageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  languageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 12,
  },
  divider: {
    height: 1,
  },
});

