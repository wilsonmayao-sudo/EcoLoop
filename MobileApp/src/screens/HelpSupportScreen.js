import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/ui/Header';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const translations = {
  en: {
    title: 'Help & Support',
    contact: 'Contact Us',
    email: 'Email',
    phone: 'Phone',
    faqs: 'Frequently Asked Questions',
    faq1Q: 'How do I navigate the app?',
    faq1A: 'Use the bottom navigation bar to switch between Home, Map, Reports, Profile, and Settings screens.',
    faq2Q: 'How do I start a route?',
    faq2A: 'Go to the Map screen and select your destination. Tap "Start Route" to begin navigation.',
    faq3Q: 'How do I view the map?',
    faq3A: 'Tap the Map tab in the bottom navigation to view your current location and nearby routes.',
    faq4Q: 'How do I submit a report?',
    faq4A: 'Navigate to the Reports screen and tap "Create Report". Fill in the required information and submit.',
    faq5Q: 'How do I update my profile?',
    faq5A: 'Go to the Profile screen and tap the edit icon. You can update your avatar, name, and other details.',
    faq6Q: 'How do I change my notification settings?',
    faq6A: 'Go to Settings and toggle the Notifications switch to enable or disable route alerts and updates.',
    faq7Q: 'How do I switch between light and dark mode?',
    faq7A: 'In Settings, toggle the Dark Mode switch to change the app theme.',
    faq8Q: 'What should I do if the app crashes?',
    faq8A: 'Try closing and reopening the app. If the issue persists, restart your device or contact support.',
    faq9Q: 'How do I change the app language?',
    faq9A: 'Go to Settings > Language and select your preferred language (English or Tagalog).',
    faq10Q: 'How do I report a bug or issue?',
    faq10A: 'Contact our support team via email or phone using the contact information above. Please provide details about the issue.',
  },
  tl: {
    title: 'Tulong at Suporta',
    contact: 'Makipag-ugnayan sa Amin',
    email: 'Email',
    phone: 'Telepono',
    faqs: 'Mga Madalas Itanong',
    faq1Q: 'Paano ko mag-navigate sa app?',
    faq1A: 'Gamitin ang bottom navigation bar para lumipat sa pagitan ng Home, Map, Reports, Profile, at Settings screens.',
    faq2Q: 'Paano ko simulan ang isang ruta?',
    faq2A: 'Pumunta sa Map screen at piliin ang iyong destinasyon. Tap "Start Route" para magsimula ng navigation.',
    faq3Q: 'Paano ko tingnan ang mapa?',
    faq3A: 'Tap ang Map tab sa bottom navigation para makita ang iyong kasalukuyang lokasyon at malapit na mga ruta.',
    faq4Q: 'Paano ko magsumite ng report?',
    faq4A: 'Pumunta sa Reports screen at tap "Create Report". Punan ang kinakailangang impormasyon at isumite.',
    faq5Q: 'Paano ko i-update ang aking profile?',
    faq5A: 'Pumunta sa Profile screen at tap ang edit icon. Maaari mong i-update ang iyong avatar, pangalan, at iba pang detalye.',
    faq6Q: 'Paano ko baguhin ang aking notification settings?',
    faq6A: 'Pumunta sa Settings at toggle ang Notifications switch para i-enable o i-disable ang route alerts at updates.',
    faq7Q: 'Paano ko lumipat sa pagitan ng light at dark mode?',
    faq7A: 'Sa Settings, toggle ang Dark Mode switch para baguhin ang app theme.',
    faq8Q: 'Ano ang dapat kong gawin kung nag-crash ang app?',
    faq8A: 'Subukan na isara at buksan muli ang app. Kung patuloy ang problema, i-restart ang iyong device o makipag-ugnayan sa support.',
    faq9Q: 'Paano ko baguhin ang app language?',
    faq9A: 'Pumunta sa Settings > Language at piliin ang iyong preferred language (English o Tagalog).',
    faq10Q: 'Paano ko i-report ang isang bug o issue?',
    faq10A: 'Makipag-ugnayan sa aming support team sa pamamagitan ng email o telepono gamit ang contact information sa itaas. Pakiprovide ang detalye tungkol sa issue.',
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

  const handleEmailPress = () => {
    Linking.openURL('mailto:support@ecoloop.com');
  };

  const handlePhonePress = () => {
    Linking.openURL('tel:+639123456789');
  };

  const toggleFAQ = (id) => {
    setExpandedFAQ(expandedFAQ === id ? null : id);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t.title} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Contact Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>{t.contact}</Text>
          <View style={styles.contactRow}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
            <TouchableOpacity onPress={handleEmailPress} style={styles.contactButton}>
              <Text style={[dynamicStyles.contactText, { color: colors.primary }]}>support@ecoloop.com</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.contactRow}>
            <Ionicons name="call-outline" size={20} color={colors.primary} />
            <TouchableOpacity onPress={handlePhonePress} style={styles.contactButton}>
              <Text style={[dynamicStyles.contactText, { color: colors.primary }]}>+63 912 345 6789</Text>
            </TouchableOpacity>
          </View>
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
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  contactButton: {
    flex: 1,
  },
  faqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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

