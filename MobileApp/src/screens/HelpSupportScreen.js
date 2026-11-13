import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/ui/Header';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const translations = {
  en: {
    title: 'Help & Support',
    contact: 'Operations Support',
    supportOffice: 'Naga City Solid Waste Management Office (SWMO)',
    supportGuidance: 'For route assignments, vehicle issues, or account access assistance, contact your assigned SWMO Dispatcher or System Administrator.',
    faqs: 'Frequently Asked Questions',
    faq1Q: 'How do I navigate the app?',
    faq1A: 'Use the bottom navigation bar to switch between Home, Navigate, Reports, and Profile screens.',
    faq2Q: 'How do I start a route?',
    faq2A: 'Accept your assigned route on Home, then tap Start Route to open sequential stop navigation.',
    faq3Q: 'How do I view the map?',
    faq3A: 'Tap the Navigate tab in the bottom navigation to view your current GPS location and active destination.',
    faq4Q: 'How do I submit a report?',
    faq4A: 'Go to the Reports tab and tap New. Fill in the required issue details and submit.',
    faq5Q: 'How do I update my profile?',
    faq5A: 'Go to the Profile screen and tap the edit icon. You can update your avatar, name, and other details.',
    faq6Q: 'How do I change my notification settings?',
    faq6A: 'Go to Profile and toggle the Notifications switch under Settings to enable or disable route alerts and updates.',
    faq7Q: 'How do I switch between light and dark mode?',
    faq7A: 'In Profile, toggle the Dark Mode switch under Settings to change the app theme.',
    faq8Q: 'What should I do if the app crashes?',
    faq8A: 'Try closing and reopening the app. If the issue persists, restart your device or contact support.',
    faq9Q: 'How do I change the app language?',
    faq9A: 'Go to Profile > Language and select your preferred language (English or Tagalog).',
    faq10Q: 'How do I report a bug or issue?',
    faq10A: 'Report field issues through the Reports tab, or notify your SWMO Dispatcher or System Administrator with details of the issue.',
  },
  tl: {
    title: 'Tulong at Suporta',
    contact: 'Suporta sa Operasyon',
    supportOffice: 'Naga City Solid Waste Management Office (SWMO)',
    supportGuidance: 'Para sa ruta, isyu sa sasakyan, o tulong sa account, makipag-ugnayan sa iyong nakatalagang SWMO Dispatcher o System Administrator.',
    faqs: 'Mga Madalas Itanong',
    faq1Q: 'Paano ko mag-navigate sa app?',
    faq1A: 'Gamitin ang bottom navigation bar para lumipat sa pagitan ng Home, Navigate, Reports, at Profile screens.',
    faq2Q: 'Paano ko simulan ang isang ruta?',
    faq2A: 'Tanggapin ang nakatalagang ruta sa Home, pagkatapos ay i-tap ang Start Route para magsimula ng navigation.',
    faq3Q: 'Paano ko tingnan ang mapa?',
    faq3A: 'I-tap ang Navigate tab sa bottom navigation para makita ang iyong kasalukuyang lokasyon at aktibong destinasyon.',
    faq4Q: 'Paano ko magsumite ng report?',
    faq4A: 'Pumunta sa Reports tab at i-tap ang New. Punan ang kinakailangang impormasyon at isumite.',
    faq5Q: 'Paano ko i-update ang aking profile?',
    faq5A: 'Pumunta sa Profile screen at tap ang edit icon. Maaari mong i-update ang iyong avatar, pangalan, at iba pang detalye.',
    faq6Q: 'Paano ko baguhin ang aking notification settings?',
    faq6A: 'Pumunta sa Profile at i-toggle ang Notifications switch sa Settings para i-enable o i-disable ang route alerts at updates.',
    faq7Q: 'Paano ko lumipat sa pagitan ng light at dark mode?',
    faq7A: 'Sa Profile, i-toggle ang Dark Mode switch sa Settings para baguhin ang app theme.',
    faq8Q: 'Ano ang dapat kong gawin kung nag-crash ang app?',
    faq8A: 'Subukan na isara at buksan muli ang app. Kung patuloy ang problema, i-restart ang iyong device o makipag-ugnayan sa support.',
    faq9Q: 'Paano ko baguhin ang app language?',
    faq9A: 'Pumunta sa Profile > Language at piliin ang iyong preferred language (English o Tagalog).',
    faq10Q: 'Paano ko i-report ang isang bug o issue?',
    faq10A: 'Mag-submit ng field issue sa Reports tab, o ipagbigay-alam sa iyong SWMO Dispatcher o System Administrator ang detalye ng problema.',
  },
};

const FAQs = [
  { id: 1, q: 'faq1Q', a: 'faq1A' },
  { id: 2, q: 'faq2Q', a: 'faq2A' },
  { id: 3, q: 'faq3Q', a: 'faq3A' },
  { id: 4, q: 'faq4Q', a: 'faq4A' },
  { id: 5, q: 'faq5Q', a: 'faq5A' },
  { id: 6, q: 'faq6Q', a: 'faq6A' },
  { id: 7, q: 'faq7Q', a: 'faq7A' },
  { id: 8, q: 'faq8Q', a: 'faq8A' },
  { id: 9, q: 'faq9Q', a: 'faq9A' },
  { id: 10, q: 'faq10Q', a: 'faq10A' },
];

export default function HelpSupportScreen({ navigation }) {
  const { colors } = useTheme();
  const { language } = useLanguage();
  const t = translations[language];
  const dynamicStyles = getDynamicStyles(colors);
  const [expandedFAQ, setExpandedFAQ] = useState(null);

  const toggleFAQ = (id) => {
    setExpandedFAQ(expandedFAQ === id ? null : id);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t.title} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Support Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>{t.contact}</Text>
          <View style={styles.contactRow}>
            <Ionicons name="business-outline" size={20} color={colors.primary} />
            <Text style={[dynamicStyles.contactText, { color: colors.textPrimary }]}>{t.supportOffice}</Text>
          </View>
          <Text style={[dynamicStyles.faqAnswerText, { color: colors.textSecondary, marginTop: 4 }]}>
            {t.supportGuidance}
          </Text>
        </View>

        {/* FAQs Section */}
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>{t.faqs}</Text>
          {FAQs.map((faq) => (
            <View key={faq.id}>
              <TouchableOpacity
                style={styles.faqItem}
                onPress={() => toggleFAQ(faq.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: expandedFAQ === faq.id }}
                accessibilityLabel={t[faq.q]}
              >
                <Text style={[dynamicStyles.faqQuestion, { color: colors.textPrimary }]}>
                  {t[faq.q]}
                </Text>
                <Ionicons
                  name={expandedFAQ === faq.id ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              {expandedFAQ === faq.id && (
                <View style={styles.faqAnswer}>
                  <Text style={[dynamicStyles.faqAnswerText, { color: colors.textSecondary }]}>
                    {t[faq.a]}
                  </Text>
                </View>
              )}
              {faq.id < FAQs.length && (
                <View style={[styles.divider, { backgroundColor: colors.textSecondary + '1A' }]} />
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getDynamicStyles(colors) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 16,
    },
    contactText: {
      fontSize: 16,
      fontWeight: '500',
      marginLeft: 12,
    },
    faqQuestion: {
      fontSize: 16,
      fontWeight: '600',
      flex: 1,
      marginRight: 12,
    },
    faqAnswerText: {
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
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
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  contactButton: {
    flex: 1,
    paddingVertical: 10,
  },
  faqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: 12,
  },
  faqAnswer: {
    paddingBottom: 12,
  },
  divider: {
    height: 1,
    marginLeft: 0,
  },
});

