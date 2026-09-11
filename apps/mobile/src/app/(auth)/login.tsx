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
import { Mail, Lock, Eye, EyeOff, ArrowRight, Check } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Logo } from '../../components/common/Logo';
import { AnimatedNodeVisual } from '../../components/common/AnimatedNodeVisual';

export default function LoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const setAuthSession = useAuthStore((s) => s.setAuthSession);
  const showToast = useUIStore((s) => s.showToast);

  const [email, setEmail] = useState('truong@example.com');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Micro-interaction shared values for transition animation
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

  const handleLogin = async () => {
    if (!email || !password) {
      showToast({ type: 'warning', title: 'Input Error', message: 'Please enter email and password.' });
      return;
    }
    setLoading(true);
    try {
      const session = await authRepository.login(email, password);
      setIsSuccess(true);
      setAuthSession(session.user, session.tokens);
      showToast({ type: 'success', title: 'Welcome Back 👋', message: `Logged in as ${session.user.name}` });
      setTimeout(() => {
        router.replace('/(app)/(tabs)');
      }, 500);
    } catch (err: any) {
      showToast({ type: 'error', title: 'Login Failed', message: err.message || 'Invalid credentials' });
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

      {/* SOPHISTICATED AMBIENT BACKGROUND */}
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

            {/* LOGIN CARD (Clean Floating Glass Surface) */}
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
                <Text style={[styles.title, { color: colors.text }]}>{t('auth.sign_in')}</Text>
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                  {t('auth.sign_in_sub')}
                </Text>
              </View>

              {/* FORM FIELDS */}
              <View style={styles.form}>

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
                </View>
              </View>

              {/* PRIMARY CTA BUTTON */}
              <Animated.View style={animatedButtonStyle}>
                <Pressable
                  style={[styles.ctaButton, isSuccess && styles.ctaSuccess]}
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={loading || isSuccess}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : isSuccess ? (
                    <View style={styles.successRow}>
                      <Check color="#ffffff" size={18} />
                      <Text style={styles.ctaText}>Logged In</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.ctaText}>{t('auth.sign_in_btn')}</Text>
                      <ArrowRight color="#ffffff" size={16} />
                    </>
                  )}
                </Pressable>
              </Animated.View>

              {/* REGISTER LINK */}
              <Pressable onPress={() => router.push('/(auth)/register')} style={styles.linkBtn}>
                <Text style={[styles.linkText, { color: colors.textMuted }]}>
                  {t('auth.no_account')}{' '}
                  <Text style={[styles.linkHighlight, { color: colors.primary }]}>{t('auth.register_now')}</Text>
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
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'center',
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

  // LOGIN CARD
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    gap: 20,
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
    gap: 14,
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
