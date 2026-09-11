import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Check } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Logo } from '../../components/common/Logo';
import { AnimatedNodeVisual } from '../../components/common/AnimatedNodeVisual';

export default function RegisterScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const setAuthSession = useAuthStore((s) => s.setAuthSession);
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'name' | 'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Micro-interaction shared values
  const cardOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(16);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    cardOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });
    cardTranslateY.value = withTiming(0, { duration: 450, easing: Easing.out(Easing.back(1.2)) });
  }, [cardOpacity, cardTranslateY]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: colors.border };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    switch (score) {
      case 1:
        return { score: 1, label: 'Weak', color: '#ef4444' };
      case 2:
        return { score: 2, label: 'Fair', color: '#f59e0b' };
      case 3:
        return { score: 3, label: 'Strong', color: '#3b82f6' };
      case 4:
        return { score: 4, label: 'Excellent', color: '#10b981' };
      default:
        return { score: 0, label: 'Very Weak', color: '#ef4444' };
    }
  };

  const passStrength = getPasswordStrength(password);

  const handleRegister = async () => {
    if (!email || !password || !name) {
      showToast({ type: 'warning', title: 'Input Error', message: 'Please fill in all fields.' });
      return;
    }
    setLoading(true);
    try {
      const session = await authRepository.register(email, name, password);
      setIsSuccess(true);
      setAuthSession(session.user, session.tokens);
      showToast({ type: 'success', title: 'Account Created 🎉', message: `Welcome to WEAV, ${session.user.name}` });
      setTimeout(() => {
        router.replace('/(app)/(tabs)');
      }, 600);
    } catch (err: any) {
      showToast({ type: 'error', title: 'Registration Failed', message: err.message || 'Could not register account' });
    } finally {
      setLoading(false);
    }
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.98);
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.container, { backgroundColor: colors.bg }]}>

      {/* SOPHISTICATED AMBIENT BACKGROUND (Subtle glowing gradient orbs & particles) */}
      <View
        style={[
          styles.ambientOrb1,
          { backgroundColor: colors.isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)' },
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.ambientOrb2,
          { backgroundColor: colors.isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.06)' },
        ]}
        pointerEvents="none"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.mainWrapper, isDesktop && styles.desktopWrapper]}>

          {/* DESKTOP LEFT BRANDING COLUMN */}
          {isDesktop && (
            <View style={styles.desktopLeftCol}>
              <Logo size="lg" showSubtitle={true} />
              <View style={styles.desktopVisualContainer}>
                <AnimatedNodeVisual size={96} />
              </View>
            </View>
          )}

          {/* RIGHT / MAIN CONTENT AREA */}
          <View style={[styles.centerContent, isDesktop && styles.desktopRightCol]}>

            {/* BRANDING HEADER (Mobile / Centered) */}
            {!isDesktop && (
              <View style={styles.brandHeader}>
                <Logo size="md" showSubtitle={true} />
                <View style={styles.nodeVisualWrapper}>
                  <AnimatedNodeVisual size={40} />
                </View>
              </View>
            )}

            {/* REGISTER CARD (Clean Floating Glass Card) */}
            <Animated.View
              style={[
                styles.card,
                {
                  backgroundColor: colors.isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.9)',
                  borderColor: colors.border,
                },
                animatedCardStyle,
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.title, { color: colors.text }]}>{t('auth.register_title')}</Text>
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                  Start building your workspace with WEAV.
                </Text>
              </View>

              {/* FORM FIELDS */}
              <View style={styles.form}>

                {/* Full Name Input */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSubtle }]}>{t('auth.full_name')}</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong },
                      focusedInput === 'name' && { borderColor: colors.primary },
                    ]}
                  >
                    <User color={focusedInput === 'name' ? colors.primary : colors.textSubtle} size={18} />
                    <TextInput
                      style={[styles.input, { color: colors.text }]}
                      value={name}
                      onChangeText={setName}
                      placeholder="Nguyễn Anh Xuân Trường"
                      placeholderTextColor={colors.textSubtle}
                      onFocus={() => setFocusedInput('name')}
                      onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>

                {/* Email Address Input */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSubtle }]}>{t('auth.email')}</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong },
                      focusedInput === 'email' && { borderColor: colors.primary },
                    ]}
                  >
                    <Mail color={focusedInput === 'email' ? colors.primary : colors.textSubtle} size={18} />
                    <TextInput
                      style={[styles.input, { color: colors.text }]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="name@company.com"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      onFocus={() => setFocusedInput('email')}
                      onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>

                {/* Password Input */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSubtle }]}>{t('auth.password')}</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong },
                      focusedInput === 'password' && { borderColor: colors.primary },
                    ]}
                  >
                    <Lock color={focusedInput === 'password' ? colors.primary : colors.textSubtle} size={18} />
                    <TextInput
                      style={[styles.input, { color: colors.text }]}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="••••••••"
                      placeholderTextColor={colors.textSubtle}
                      secureTextEntry={!showPassword}
                      onFocus={() => setFocusedInput('password')}
                      onBlur={() => setFocusedInput(null)}
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                      {showPassword ? (
                        <EyeOff color={colors.textSubtle} size={18} />
                      ) : (
                        <Eye color={colors.textSubtle} size={18} />
                      )}
                    </Pressable>
                  </View>

                  {/* Subtle Password Strength Indicator */}
                  {password.length > 0 && (
                    <View style={styles.strengthGroup}>
                      <View style={styles.strengthHeader}>
                        <Text style={[styles.strengthText, { color: passStrength.color }]}>
                          {passStrength.label}
                        </Text>
                      </View>
                      <View style={styles.strengthBars}>
                        {[1, 2, 3, 4].map((barIndex) => (
                          <View
                            key={barIndex}
                            style={[
                              styles.strengthBarSegment,
                              { backgroundColor: barIndex <= passStrength.score ? passStrength.color : colors.border },
                            ]}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* PRIMARY CTA BUTTON */}
              <Animated.View style={animatedButtonStyle}>
                <Pressable
                  style={[styles.ctaButton, isSuccess && styles.ctaSuccess]}
                  onPress={handleRegister}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={loading || isSuccess}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : isSuccess ? (
                    <View style={styles.successRow}>
                      <Check color="#ffffff" size={18} />
                      <Text style={styles.ctaText}>Created</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.ctaText}>{t('auth.create_btn')}</Text>
                      <ArrowRight color="#ffffff" size={16} />
                    </>
                  )}
                </Pressable>
              </Animated.View>

              {/* SIGN IN LINK */}
              <Pressable onPress={() => router.push('/(auth)/login')} style={styles.linkBtn}>
                <Text style={[styles.linkText, { color: colors.textMuted }]}>
                  {t('auth.have_account')}{' '}
                  <Text style={[styles.linkHighlight, { color: colors.primary }]}>{t('auth.sign_in')}</Text>
                </Text>
              </Pressable>
            </Animated.View>

          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  ambientOrb1: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  ambientOrb2: {
    position: 'absolute',
    bottom: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  mainWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  desktopWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 900,
    alignSelf: 'center',
    gap: 64,
  },

  // Desktop Left Column
  desktopLeftCol: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 32,
  },
  desktopVisualContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Mobile / Center Content Area
  centerContent: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  desktopRightCol: {
    width: 420,
  },

  // Mobile Header
  brandHeader: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  nodeVisualWrapper: {
    marginVertical: 2,
  },

  // REGISTER CARD
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    gap: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
  cardHeader: {
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  form: {
    gap: 12,
  },
  inputGroup: {
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 52,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 13,
    height: '100%',
  },
  eyeBtn: {
    padding: 4,
  },

  // Password Strength Indicator
  strengthGroup: {
    gap: 4,
    marginTop: 2,
  },
  strengthHeader: {
    alignItems: 'flex-end',
  },
  strengthText: {
    fontSize: 10,
    fontWeight: '700',
  },
  strengthBars: {
    flexDirection: 'row',
    gap: 4,
    height: 3,
  },
  strengthBarSegment: {
    flex: 1,
    borderRadius: 2,
  },

  // PRIMARY CTA BUTTON
  ctaButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    height: 52,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaSuccess: {
    backgroundColor: '#10b981',
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ctaText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  // Link
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  linkText: {
    fontSize: 12,
  },
  linkHighlight: {
    fontWeight: '800',
  },
});
