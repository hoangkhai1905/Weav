import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, KeyRound, Lock, Mail, RefreshCw, Send } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { expireAuthSession } from '../../features/auth/auth-session.runtime';
import {
  createPasswordRecoverySubmissionGate,
  isPasswordRecoveryFlowCurrent,
  type PasswordRecoveryValidationErrors,
  validatePasswordRecovery,
} from '../../features/auth/password-recovery.utils';
import { localizeValidation } from '../../features/common/validation-copy';
import { useAuthStore } from '../../stores/auth.store';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { AuthShell } from '../../components/ui/AuthShell';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../features/auth/auth-session.scope';
import { showMilestoneToast } from '../../features/feedback/milestone-toast';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

/** Friendly message key from the HTTP status only; raw backend text is never shown. */
function recoveryErrorKey(error: unknown, verifying: boolean): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return 'au.forgot.err.429';
  if (verifying && (status === 400 || status === 401)) return 'au.forgot.err.code';
  return 'au.forgot.err.generic';
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const mounted = useRef(true);
  const flowGeneration = useRef(0);
  const submissionGate = useRef(createPasswordRecoverySubmissionGate());

  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      setMessage(t('au.forgot.sent').replace('{n}', String(receipt.expiresIn)));
    } catch (requestError: unknown) {
      if (isCurrentFlow(generation)) setError(t(recoveryErrorKey(requestError, false)));
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
      setError(grantConsumed ? t('au.forgot.err.used') : null);
      submissionGate.current.finish();
      return;
    }

    const generation = startFlow();
    const capturedScope = captureAuthSessionScope();
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
      const current = useAuthStore.getState();
      if (capturedScope) {
        if (!isAuthSessionScopeCurrent(capturedScope)) return;
        await expireAuthSession();
      } else if (current.isAuthenticated) {
        return;
      }
      if (!isCurrentFlow(generation)) return;
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      showMilestoneToast('auth.password_reset');
      router.replace('/(auth)/login');
    } catch (resetError: unknown) {
      if (!isCurrentFlow(generation)) return;
      if (verified) setGrantConsumed(true);
      setError(t(recoveryErrorKey(resetError, true)));
    } finally {
      if (isCurrentFlow(generation)) setIsPending(false);
      submissionGate.current.finish();
    }
  };

  const resendDisabled = isPending || cooldownRemaining > 0;
  const resendLabel = cooldownRemaining > 0 ? t('au.forgot.resendIn').replace('{n}', String(cooldownRemaining)) : t('au.forgot.resend');

  return (
    <AuthShell
      title={t('au.forgot.title')}
      subtitle={challengeId ? t('au.forgot.subtitleCode') : t('au.forgot.subtitle')}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('au.back')}
        onPress={() => router.replace('/(auth)/login')}
        style={styles.back}
      >
        <ArrowLeft color={colors.textMuted} size={16} />
        <Text style={[Typography.label, { color: colors.textMuted }]}>{t('au.back')}</Text>
      </Pressable>

      {!challengeId ? (
        <>
          <TextField
              testID="password-recovery-email"
              label={t('au.email')}
              icon={Mail}
              value={email}
              onChangeText={(value) => { setEmail(value); setValidationErrors({}); setError(null); }}
              error={localizeValidation(validationErrors.email)}
              placeholder={t('au.emailPlaceholder')}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
          <View testID="password-recovery-request">
            <Button
              label={t('au.forgot.sendCode')}
              icon={<Send size={18} color={colors.onPrimary} />}
              busy={isPending}
              onPress={() => { void handleRequestCode(); }}
            />
          </View>
        </>
      ) : (
        <>
          <TextField
            testID="password-recovery-code"
            label={t('au.code')}
            icon={KeyRound}
            value={code}
            onChangeText={(value) => { setCode(value.replace(/\D/g, '').slice(0, 6)); setValidationErrors((current) => ({ ...current, code: undefined })); setError(null); }}
            error={localizeValidation(validationErrors.code)}
            placeholder={t('au.codePlaceholder')}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
          <TextField
            testID="password-recovery-new"
            label={t('au.newPassword')}
            icon={Lock}
            secure
            value={newPassword}
            onChangeText={(value) => { setNewPassword(value); setValidationErrors((current) => ({ ...current, newPassword: undefined })); setError(null); }}
            error={localizeValidation(validationErrors.newPassword)}
            hint={t('au.passwordHint')}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <TextField
            testID="password-recovery-confirm"
            label={t('au.confirmPassword')}
            icon={Lock}
            secure
            value={confirmPassword}
            onChangeText={(value) => { setConfirmPassword(value); setValidationErrors((current) => ({ ...current, confirmPassword: undefined })); setError(null); }}
            error={localizeValidation(validationErrors.confirmPassword)}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <View testID="password-recovery-submit">
            <Button
              label={t('au.forgot.reset')}
              icon={<KeyRound size={18} color={colors.onPrimary} />}
              busy={isPending}
              disabled={grantConsumed}
              onPress={() => { void handleResetPassword(); }}
            />
          </View>
          <View testID="password-recovery-resend">
            <Button
              variant="secondary"
              label={resendLabel}
              icon={<RefreshCw size={18} color={colors.text} />}
              disabled={resendDisabled}
              onPress={() => { void handleRequestCode(); }}
            />
          </View>
        </>
      )}

      {message ? (
        <Text testID="password-recovery-message" style={[Typography.caption, { color: colors.success }]}>{message}</Text>
      ) : null}
      {error ? (
        <Text testID="password-recovery-error" accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start', minHeight: MinTouch },
});
