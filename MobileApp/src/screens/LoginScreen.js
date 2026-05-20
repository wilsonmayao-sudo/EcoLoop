import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import AppButton from '../components/ui/AppButton';
import SurfaceCard from '../components/ui/SurfaceCard';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

export default function LoginScreen({ onLogin, onSignup, authError }) {
  const { colors, tokens } = useTheme();
  const [isSignup, setIsSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setError('');
    setSuccessMessage('');

    if (isSignup) {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const trimmedPhone = phoneNumber.trim();

      if (!trimmedName || !trimmedEmail || !password || !trimmedPhone) {
        setError('Please enter full name, email, password, and phone number.');
        return;
      }
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        setError('Please enter a valid email address.');
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
        return;
      }
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        setError('Password must include both letters and numbers.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      setIsSubmitting(true);
      try {
        await onSignup?.({
          fullName: trimmedName,
          email: trimmedEmail,
          password,
          phoneNumber: trimmedPhone,
        });
        setError('');
        Alert.alert('Sign Up', 'Your account has been submitted and is waiting for admin approval.');
        setSuccessMessage('Account submitted successfully. Wait for admin approval.');
        setIsSignup(false);
        setName('');
        setEmail('');
        setPhoneNumber('');
        setPassword('');
        setConfirmPassword('');
        return;
      } catch (signupError) {
        setError(signupError?.message ?? 'Unable to sign up right now.');
        return;
      } finally {
        setIsSubmitting(false);
      }
    } else {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setError('Please enter email and password.');
        return;
      }
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        setError('Please enter a valid email address.');
        return;
      }
      setIsSubmitting(true);
      try {
        await onLogin?.({ email: trimmedEmail, password });
        setError('');
      } catch (loginError) {
        setError(loginError?.message ?? 'Unable to log in.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={[styles.logoMark, { backgroundColor: colors.primary + "22" }]}>
              <Ionicons name="leaf" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.textPrimary }]}>EcoLoop</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {isSignup ? "Driver sign up" : "Driver login"}
            </Text>
          </View>

          <SurfaceCard elevated={false} style={styles.formCard}>
            {isSignup && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Full Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor={colors.textSecondary + '66'}
                  style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
                  autoCapitalize="words"
                  textContentType="name"
                />

                <Text style={[styles.label, { color: colors.textSecondary }]}>Phone Number</Text>
                <TextInput
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="+63 9XX XXX XXXX"
                  placeholderTextColor={colors.textSecondary + '66'}
                  style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                />

                <View style={[styles.rolePill, { borderColor: colors.primary + '55', backgroundColor: colors.primary + '12' }]}>
                  <Ionicons name="id-card-outline" size={16} color={colors.primary} />
                  <Text style={[styles.rolePillText, { color: colors.primary }]}>Role: Truck Driver</Text>
                </View>
              </>
            )}

            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (error) setError('');
              }}
              placeholder="Email address"
              placeholderTextColor={colors.textSecondary + '66'}
              style={[styles.input, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
            <View style={styles.passwordField}>
              <TextInput
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  if (error) setError('');
                }}
                placeholder="••••••••"
                placeholderTextColor={colors.textSecondary + '66'}
                style={[styles.input, styles.passwordInput, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
                secureTextEntry={!showPassword}
                textContentType={isSignup ? 'newPassword' : 'password'}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowPassword((prev) => !prev)} activeOpacity={0.8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {isSignup && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm Password</Text>
                <View style={styles.passwordField}>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      if (error) setError('');
                    }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSecondary + '66'}
                    style={[styles.input, styles.passwordInput, { borderColor: colors.textSecondary + '33', color: colors.textPrimary }]}
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowConfirmPassword((prev) => !prev)} activeOpacity={0.8}>
                    <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {error || authError ? <Text style={[styles.error, { color: colors.danger }]}>{error || authError}</Text> : null}
            {successMessage ? <Text style={[styles.error, { color: colors.success ?? colors.primary }]}>{successMessage}</Text> : null}

            <AppButton
              title={isSubmitting ? (isSignup ? "Creating account…" : "Signing in…") : isSignup ? "Sign up" : "Log in"}
              onPress={handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
            />

            <AppButton
              title={isSignup ? "Have an account? Log in" : "Need an account? Sign up"}
              variant="outline"
              onPress={() => {
                setError("");
                setSuccessMessage("");
                setPassword("");
                setConfirmPassword("");
                setShowPassword(false);
                setShowConfirmPassword(false);
                setIsSignup((prev) => !prev);
              }}
              disabled={isSubmitting}
              style={{ marginTop: tokens.space.sm }}
            />

            <Text style={[styles.helper, { color: colors.textSecondary, marginTop: tokens.space.md }]}>
              {isSignup
                ? "Driver accounts require admin approval before login."
                : "Sign in with your registered truck driver account."}
            </Text>
          </SurfaceCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 22,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    marginTop: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 6,
    fontWeight: "600",
  },
  formCard: {
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  passwordField: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 44,
  },
  passwordToggle: {
    position: "absolute",
    right: 12,
    top: 12,
    padding: 4,
  },
  error: {
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
  rolePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  helper: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    fontWeight: "500",
  },
});

