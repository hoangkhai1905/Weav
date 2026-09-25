import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { expireAuthSession } from '../../features/auth/auth-session.runtime';
import {
  createPasswordRecoverySubmissionGate,
  isPasswordRecoveryFlowCurrent,
  type PasswordRecoveryValidationErrors,
  validatePasswordRecovery,
} from '../../features/auth/password-recovery.utils';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Logo } from '../../components/common/Logo';
import { AnimatedNodeVisual } from '../../components/common/AnimatedNodeVisual';

function getRecoveryErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Password recovery service unavailable. Please try again.';
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const showToast = useUIStore((state) => state.showToast);
  const mounted = useRef(true);
  const flowGeneration = useRef(0);
  const submissionGate = useRef(createPasswordRecoverySubmissionGate());

  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [retryAvailableAt, setRetryAvailableAt] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [grantConsumed, setGrantConsumed] = useState(false);
  const [validationErrors, setValidationErrors] = useState<PasswordRecoveryValidationErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    return () => {
      mounted.current = false;
      flowGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!retryAvailableAt) {
      setCooldownRemaining(0);
      return undefined;
    }
    const update = () => {
      setCooldownRemaining(Math.max(0, Math.ceil((retryAvailableAt - Date.now()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAvailableAt]);

  const isCurrentFlow = (generation: number) =>
    isPasswordRecoveryFlowCurrent(generation, flowGeneration.current, mounted.current);

  const startFlow = () => {
    flowGeneration.current += 1;
    return flowGeneration.current;
  };

  const handleRequestCode = async () => {
    if (!submissionGate.current.tryStart()) return;
    const emailValidation = validatePasswordRecovery({
      email,
      code: '123456',
      newPassword: 'valid-password',
      confirmPassword: 'valid-password',
    });
    if (emailValidation.email) {
      setValidationErrors({ email: emailValidation.email });
      setError(null);
      submissionGate.current.finish();
      return;
    }

    const generation = startFlow();
    setIsPending(true);
    setValidationErrors({});
    setError(null);
    setMessage(null);
    try {
      const receipt = await authRepository.requestPasswordReset(email);
      if (!isCurrentFlow(generation)) return;
      setChallengeId(receipt.challengeId);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setGrantConsumed(false);
      setRetryAvailableAt(Date.now() + receipt.retryAfter * 1000);
      setMessage(`Request accepted. If the account is eligible, enter the code from your email within ${receipt.expiresIn} seconds.`);
    } catch (requestError: unknown) {
      if (isCurrentFlow(generation)) setError(getRecoveryErrorMessage(requestError));
    } finally {
      if (isCurrentFlow(generation)) setIsPending(false);
      submissionGate.current.finish();
    }
  };

  const handleResetPassword = async () => {
    if (!submissionGate.current.tryStart()) return;
    const errors = validatePasswordRecovery({ email, code, newPassword, confirmPassword });
    const resetErrors = { ...errors, email: undefined };
    if (Object.values(resetErrors).some(Boolean) || !challengeId || grantConsumed) {
      setValidationErrors(resetErrors);
      setError(grantConsumed ? 'This reset attempt is no longer valid. Request a new code.' : null);
      submissionGate.current.finish();
      return;
    }

    const generation = startFlow();
    setIsPending(true);
    setValidationErrors({});
    setError(null);
    setMessage(null);
    let verified = false;
    try {
      const verification = await authRepository.verifyPasswordResetOtp(challengeId, code);
      if (!isCurrentFlow(generation)) return;
      verified = true;
      await authRepository.resetPassword(verification.resetToken, newPassword);
      if (!isCurrentFlow(generation)) return;

      const wasAuthenticated = useAuthStore.getState().isAuthenticated;
      if (wasAuthenticated) await expireAuthSession();
      if (!isCurrentFlow(generation)) return;
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      showToast({ type: 'success', title: 'Password reset', message: 'You can sign in with your new password.' });
      router.replace('/(auth)/login');
    } catch (resetError: unknown) {
      if (!isCurrentFlow(generation)) return;
      if (verified) setGrantConsumed(true);
      setError(getRecoveryErrorMessage(resetError));
    } finally {
      if (isCurrentFlow(generation)) setIsPending(false);
      submissionGate.current.finish();
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.brandHeader}>
          <Logo size="md" showSubtitle={true} />
          <View style={styles.nodeVisualWrapper}><AnimatedNodeVisual size={40} /></View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable onPress={() => router.replace('/(auth)/login')} style={styles.backButton}>
            <ArrowLeft color={colors.textMuted} size={15} />
            <Text style={[styles.backText, { color: colors.textMuted }]}>Back to sign in</Text>
          </Pressable>

          <View style={styles.headingRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.primaryBg }]}>
              <ShieldCheck color={colors.primary} size={22} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: colors.text }]}>Reset your password</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>Use the verification code from your email.</Text>
            </View>
          </View>

          {!challengeId ? (
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSubtle }]}>Email address</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
                  <Mail color={colors.textSubtle} size={18} />
                  <TextInput
                    testID="password-recovery-email"
                    value={email}
                    onChangeText={(value) => { setEmail(value); setValidationErrors({}); setError(null); }}
                    placeholder="name@company.com"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={[styles.input, { color: colors.text }]}
                  />
                </View>
                {validationErrors.email && <Text testID="password-recovery-email-error" style={[styles.inlineError, { color: colors.danger }]}>{validationErrors.email}</Text>}
              </View>

              <Pressable testID="password-recovery-request" disabled={isPending} onPress={() => { void handleRequestCode(); }} style={[styles.ctaButton, { backgroundColor: colors.primary }, isPending && styles.disabledButton]}>
                {isPending ? <ActivityIndicator color="#ffffff" /> : <><Text style={styles.ctaText}>Send reset code</Text><ArrowRight color="#ffffff" size={16} /></>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSubtle }]}>Verification code</Text>
                <TextInput
                  testID="password-recovery-code"
                  value={code}
                  onChangeText={(value) => { setCode(value.replace(/\D/g, '').slice(0, 6)); setValidationErrors((current) => ({ ...current, code: undefined })); setError(null); }}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.inputStandalone, { color: colors.text, backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}
                />
                {validationErrors.code && <Text testID="password-recovery-code-error" style={[styles.inlineError, { color: colors.danger }]}>{validationErrors.code}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSubtle }]}>New password</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
                  <Lock color={colors.textSubtle} size={18} />
                  <TextInput
                    testID="password-recovery-new"
                    value={newPassword}
                    onChangeText={(value) => { setNewPassword(value); setValidationErrors((current) => ({ ...current, newPassword: undefined })); setError(null); }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSubtle}
                    secureTextEntry={!showNewPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { color: colors.text }]}
                  />
                  <Pressable onPress={() => setShowNewPassword((value) => !value)} style={styles.eyeButton}>{showNewPassword ? <EyeOff color={colors.textSubtle} size={18} /> : <Eye color={colors.textSubtle} size={18} />}</Pressable>
                </View>
                {validationErrors.newPassword && <Text testID="password-recovery-new-error" style={[styles.inlineError, { color: colors.danger }]}>{validationErrors.newPassword}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSubtle }]}>Confirm new password</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
                  <Lock color={colors.textSubtle} size={18} />
                  <TextInput
                    testID="password-recovery-confirm"
                    value={confirmPassword}
                    onChangeText={(value) => { setConfirmPassword(value); setValidationErrors((current) => ({ ...current, confirmPassword: undefined })); setError(null); }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSubtle}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { color: colors.text }]}
                  />
                  <Pressable onPress={() => setShowConfirmPassword((value) => !value)} style={styles.eyeButton}>{showConfirmPassword ? <EyeOff color={colors.textSubtle} size={18} /> : <Eye color={colors.textSubtle} size={18} />}</Pressable>
                </View>
                {validationErrors.confirmPassword && <Text testID="password-recovery-confirm-error" style={[styles.inlineError, { color: colors.danger }]}>{validationErrors.confirmPassword}</Text>}
              </View>

              <Pressable testID="password-recovery-submit" disabled={isPending || grantConsumed} onPress={() => { void handleResetPassword(); }} style={[styles.ctaButton, { backgroundColor: colors.primary }, (isPending || grantConsumed) && styles.disabledButton]}>
                {isPending ? <ActivityIndicator color="#ffffff" /> : <><Text style={styles.ctaText}>Reset password</Text><ArrowRight color="#ffffff" size={16} /></>}
              </Pressable>

              <Pressable testID="password-recovery-resend" disabled={isPending || cooldownRemaining > 0} onPress={() => { void handleRequestCode(); }} style={[styles.secondaryButton, { borderColor: colors.primary }, (isPending || cooldownRemaining > 0) && styles.disabledButton]}>
                <RefreshCw color={colors.primary} size={15} />
                <Text style={[styles.secondaryText, { color: colors.primary }]}>{cooldownRemaining > 0 ? `Request a new code in ${cooldownRemaining}s` : 'Request a new code'}</Text>
              </Pressable>
            </View>
          )}

          {message && <Text testID="password-recovery-message" style={[styles.message, { color: colors.success }]}>{message}</Text>}
          {error && <Text testID="password-recovery-error" style={[styles.inlineError, { color: colors.danger }]}>{error}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  brandHeader: { alignItems: 'center', gap: 10 },
  nodeVisualWrapper: { marginVertical: 2 },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 24, borderWidth: 1, padding: 24, gap: 18 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 3 },
  backText: { fontSize: 12, fontWeight: '700' },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  headingCopy: { flex: 1, gap: 3 },
  title: { fontSize: 20, fontWeight: '900' },
  subtitle: { fontSize: 12, lineHeight: 17 },
  form: { gap: 14 },
  inputGroup: { gap: 5 },
  label: { fontSize: 11, fontWeight: '700' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 52, gap: 10 },
  input: { flex: 1, fontSize: 13, height: '100%' },
  inputStandalone: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 52, fontSize: 13 },
  eyeButton: { padding: 4 },
  inlineError: { fontSize: 12, lineHeight: 17 },
  message: { fontSize: 12, lineHeight: 17 },
  ctaButton: { borderRadius: 12, height: 52, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  ctaText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  secondaryButton: { borderWidth: 1, borderRadius: 12, height: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  secondaryText: { fontSize: 12, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
});
