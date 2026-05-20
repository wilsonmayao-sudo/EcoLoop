import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../components/ui/Header';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const translations = {
  en: {
    title: 'Privacy & Security',
    privacyPolicy: 'Privacy Policy',
    securityStatement: 'Security Statement',
    lastUpdated: 'Last Updated: January 2024',
    dataCollectionTitle: 'Data Collection',
    dataCollectionContent:
      'Ecoloop collects the following types of data:\n\n' +
      '• Personal Information: Name, email address, and user ID\n' +
      '• Location Data: GPS coordinates and route information for navigation purposes\n' +
      '• Usage Data: App interactions, feature usage, and performance metrics\n' +
      '• Device Information: Device type, operating system, and app version\n\n' +
      'All data collection is done with your explicit consent and is necessary for providing core app functionality.',
    dataUsageTitle: 'How Data is Used',
    dataUsageContent:
      'Your data is used exclusively for:\n\n' +
      '• Providing navigation and routing services\n' +
      '• Improving app performance and user experience\n' +
      '• Sending important notifications and route updates\n' +
      '• Generating reports and analytics for service improvement\n' +
      '• Ensuring app security and preventing fraudulent activities\n\n' +
      'We do not sell, rent, or share your personal data with third parties for marketing purposes.',
    dataProtectionTitle: 'Data Protection',
    dataProtectionContent:
      'Ecoloop implements industry-standard security measures to protect your data:\n\n' +
      '• Encryption: All data transmitted between your device and our servers is encrypted using SSL/TLS protocols\n' +
      '• Secure Storage: Personal data is stored in secure, encrypted databases\n' +
      '• Access Controls: Only authorized personnel have access to user data\n' +
      '• Regular Audits: We conduct regular security audits and vulnerability assessments\n' +
      '• Data Retention: We retain your data only for as long as necessary to provide our services\n' +
      '• User Rights: You have the right to access, modify, or delete your personal data at any time\n\n' +
      'If you have concerns about your data privacy, please contact our support team.',
  },
  tl: {
    title: 'Privacy at Seguridad',
    privacyPolicy: 'Patakaran sa Privacy',
    securityStatement: 'Pahayag sa Seguridad',
    lastUpdated: 'Huling Na-update: Enero 2024',
    dataCollectionTitle: 'Pagkolekta ng Data',
    dataCollectionContent:
      'Ang Ecoloop ay nangongolekta ng mga sumusunod na uri ng data:\n\n' +
      '• Personal na Impormasyon: Pangalan, email address, at user ID\n' +
      '• Location Data: GPS coordinates at route information para sa navigation\n' +
      '• Usage Data: App interactions, feature usage, at performance metrics\n' +
      '• Device Information: Uri ng device, operating system, at app version\n\n' +
      'Lahat ng pagkolekta ng data ay ginagawa sa iyong explicit consent at kinakailangan para sa core app functionality.',
    dataUsageTitle: 'Paano Ginagamit ang Data',
    dataUsageContent:
      'Ang iyong data ay ginagamit lamang para sa:\n\n' +
      '• Pagbibigay ng navigation at routing services\n' +
      '• Pagpapabuti ng app performance at user experience\n' +
      '• Pagpapadala ng mahahalagang notifications at route updates\n' +
      '• Paggawa ng reports at analytics para sa service improvement\n' +
      '• Pagtiyak ng app security at pagpigil sa fraudulent activities\n\n' +
      'Hindi namin ibinebenta, inuupahan, o ibinabahagi ang iyong personal data sa third parties para sa marketing purposes.',
    dataProtectionTitle: 'Proteksyon ng Data',
    dataProtectionContent:
      'Ang Ecoloop ay nagpapatupad ng industry-standard security measures para protektahan ang iyong data:\n\n' +
      '• Encryption: Lahat ng data na ipinapadala sa pagitan ng iyong device at aming servers ay naka-encrypt gamit ang SSL/TLS protocols\n' +
      '• Secure Storage: Ang personal data ay naka-store sa secure, encrypted databases\n' +
      '• Access Controls: Tanging authorized personnel lamang ang may access sa user data\n' +
      '• Regular Audits: Nagsasagawa kami ng regular security audits at vulnerability assessments\n' +
      '• Data Retention: Pinapanatili namin ang iyong data lamang hangga\'t kinakailangan para sa aming services\n' +
      '• User Rights: Mayroon kang karapatan na ma-access, baguhin, o tanggalin ang iyong personal data anumang oras\n\n' +
      'Kung mayroon kang mga alalahanin tungkol sa iyong data privacy, pakikipag-ugnayan sa aming support team.',
  },
};

export default function PrivacySecurityScreen({ navigation }) {
  const { colors } = useTheme();
  const { language } = useLanguage();
  const t = translations[language];
  const dynamicStyles = getDynamicStyles(colors);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header title={t.title} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Privacy Policy Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.privacyPolicy}
          </Text>
          <Text style={[dynamicStyles.lastUpdated, { color: colors.textSecondary }]}>
            {t.lastUpdated}
          </Text>
          <View style={styles.spacing} />

          <Text style={[dynamicStyles.subsectionTitle, { color: colors.textPrimary }]}>
            {t.dataCollectionTitle}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.dataCollectionContent}
          </Text>

          <View style={styles.spacing} />
          <Text style={[dynamicStyles.subsectionTitle, { color: colors.textPrimary }]}>
            {t.dataUsageTitle}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.dataUsageContent}
          </Text>
        </View>

        {/* Security Statement Section */}
        <View style={styles.spacing} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[dynamicStyles.sectionTitle, { color: colors.textPrimary }]}>
            {t.securityStatement}
          </Text>
          <View style={styles.spacing} />

          <Text style={[dynamicStyles.subsectionTitle, { color: colors.textPrimary }]}>
            {t.dataProtectionTitle}
          </Text>
          <Text style={[dynamicStyles.content, { color: colors.textSecondary }]}>
            {t.dataProtectionContent}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getDynamicStyles(colors) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 4,
    },
    lastUpdated: {
      fontSize: 12,
      fontStyle: 'italic',
      marginBottom: 8,
    },
    subsectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: 8,
      marginBottom: 8,
    },
    content: {
      fontSize: 14,
      lineHeight: 22,
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
    height: 16,
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
});

