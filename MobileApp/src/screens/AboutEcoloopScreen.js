import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../components/ui/Header';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const translations = {
  en: {
    title: 'About EcoLoop',
    introduction: 'Introduction',
    introductionContent:
      'EcoLoop is a waste collection and route planning tool that helps drivers and dispatch teams work together efficiently and support a cleaner city.',
    features: 'Features',
    featuresContent:
      '• Route Navigation: Real-time GPS navigation for waste collection routes\n' +
      '• Map Integration: Interactive maps showing collection points and optimized routes\n' +
      '• Report Generation: Create and submit reports on collection activities\n' +
      '• Profile Management: Manage your account and personal information\n' +
      '• Notifications: Receive alerts and updates about routes and schedules\n' +
      '• Multi-language Support: Available in English and Tagalog',
    purpose: 'Purpose',
    purposeContent:
      'EcoLoop aims to streamline waste collection operations, reduce environmental impact, and improve day-to-day service for residents and crews.',
    appInfo: 'App Information',
    version: 'Version',
    versionNumber: '1.2.0',
    year: 'Year',
    yearValue: '2026',
    copyright: '© 2026 EcoLoop. All rights reserved.',
  },
  tl: {
    title: 'Tungkol sa EcoLoop',
    introduction: 'Panimula',
    introductionContent:
      'Ang EcoLoop ay isang waste collection at route planning tool na tumutulong sa mga driver at dispatch team na magtulungan nang mahusay at suportahan ang mas malinis na lungsod.',
    features: 'Mga Feature',
    featuresContent:
      '• Route Navigation: Real-time GPS navigation para sa waste collection routes\n' +
      '• Map Integration: Interactive maps na nagpapakita ng collection points at optimized routes\n' +
      '• Report Generation: Gumawa at magsumite ng reports tungkol sa collection activities\n' +
      '• Profile Management: Pamahalaan ang iyong account at personal information\n' +
      '• Notifications: Tumanggap ng alerts at updates tungkol sa routes at schedules\n' +
      '• Multi-language Support: Available sa English at Tagalog',
    purpose: 'Layunin',
    purposeContent:
      'Layunin ng EcoLoop na gawing mas maayos ang waste collection operations, bawasan ang environmental impact, at pagbutihin ang serbisyo araw-araw para sa mga residente at crew.',
    appInfo: 'Impormasyon ng App',
    version: 'Bersyon',
    versionNumber: '1.2.0',
    year: 'Taon',
    yearValue: '2026',
    copyright: '© 2026 EcoLoop. Lahat ng karapatan ay nakalaan.',
  },
};

export default function AboutEcoloopScreen({ navigation }) {
  const { colors } = useTheme();
  const { language } = useLanguage();
  const t = translations[language];
  const dynamicStyles = getDynamicStyles(colors);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t.title} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Introduction Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.introduction}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.introductionContent}
          </Text>
        </View>

        {/* Features Section */}
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.features}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.featuresContent}
          </Text>
        </View>

        {/* Purpose Section */}
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.purpose}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.purposeContent}
          </Text>
        </View>

        {/* App Information Section */}
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.appInfo}
          </Text>
          <View style={styles.infoRow}>
            <Text style={[dynamicStyles.infoLabel, { color: colors.textSecondary }]}>
              {t.version}:
            </Text>
            <Text style={[dynamicStyles.infoValue, { color: colors.textPrimary }]}>
              {t.versionNumber}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[dynamicStyles.infoLabel, { color: colors.textSecondary }]}>
              {t.year}:
            </Text>
            <Text style={[dynamicStyles.infoValue, { color: colors.textPrimary }]}>
              {t.yearValue}
            </Text>
          </View>
        </View>

        {/* Copyright */}
        <View style={styles.spacing} />
        <Text style={[dynamicStyles.copyright, { color: colors.textSecondary }]}>
          {t.copyright}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function getDynamicStyles(colors) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 12,
    },
    content: {
      fontSize: 14,
      lineHeight: 22,
    },
    infoLabel: {
      fontSize: 14,
      fontWeight: '500',
      minWidth: 80,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: '600',
      flex: 1,
    },
    copyright: {
      fontSize: 12,
      textAlign: 'center',
      fontStyle: 'italic',
      marginBottom: 8,
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
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
  infoRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'center',
  },
});

