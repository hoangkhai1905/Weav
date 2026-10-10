import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Lock, LogIn, Mail } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { beginAuthOperation, establishAuthSession } from '../../features/auth/auth-session.runtime';
import { googleSignInAvailable, signInWithGoogle } from '../../features/auth/google-sign-in.runtime';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePasswordRecovery } from '../../features/auth/password-recovery.utils';
import { fieldErrorsFromError } from '../../features/common/field-errors';
import { localizeValidation } from '../../features/common/validation-copy';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { AuthShell } from '../../components/ui/AuthShell';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

type Errors = { email?: string; password?: string };

function generalErrorKey(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 409 || status === 429 || status === 400 ? `au.err.${status}` : 'au.err.network';
}

export default function LoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const validate = (): Errors => {
    const next: Errors = {};
    const emailError = validatePasswordRecovery({ email, code: '123456', newPassword: 'valid-password', confirmPassword: 'valid-password' }).email;
    if (emailError) next.email = localizeValidation(emailError) ?? undefined;
    if (!password) next.password = t('au.err.passwordRequired');
    else if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) next.password = t('au.err.passwordLength');
    return next;
  };

  const handleLogin = async () => {
    const found = validate();
    setErrors(found);
    setGeneral(null);
    if (found.email || found.password) return;
    setLoading(true);
    const operation = beginAuthOperation();
    try {
      const session = await authRepository.login(email, password);
      const applied = await establishAuthSession(session, operation);
      if (!applied) return;
      router.replace('/(app)/(tabs)');
    } catch (err: unknown) {
      const fields = fieldErrorsFromError(err);
      setErrors({ email: fields.email, password: fields.password });
      setGeneral(t(generalErrorKey(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGeneral(null);
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result.kind === 'signedIn') router.replace('/(app)/(tabs)');
      else if (result.kind === 'error') setGeneral(t(result.messageKey));
    } catch {
      setGeneral(t('au.google.err.unavailable'));
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <AuthShell title={t('au.login.title')} subtitle={t('au.login.subtitle')}>
      <TextField
        label={t('au.email')}
        icon={Mail}
        value={email}
        onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: undefined })); }}
        error={errors.email}
        placeholder={t('au.emailPlaceholder')}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <TextField
        label={t('au.password')}
        icon={Lock}
        secure
        value={password}
        onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: undefined })); }}
        error={errors.password}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => { void handleLogin(); }}
      />
      {general ? (
        <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>{general}</Text>
      ) : null}
      <Button label={t('au.signIn')} icon={<LogIn size={18} color={colors.onPrimary} />} busy={loading} disabled={googleBusy} onPress={() => { void handleLogin(); }} />
      {googleSignInAvailable ? (
        <>
          <Text style={[Typography.caption, styles.or, { color: colors.textMuted }]}>{t('au.or')}</Text>
          <Button
            testID="google-sign-in"
            variant="secondary"
            label={t('au.google.signIn')}
            busy={googleBusy}
            disabled={loading}
            onPress={() => { void handleGoogle(); }}
          />
        </>
      ) : null}
      <Pressable
        testID="password-recovery-link"
        accessibilityRole="link"
        accessibilityLabel={t('au.forgot')}
        onPress={() => router.push('/forgot-password' as Href)}
        style={styles.link}
      >
        <Text style={[Typography.label, { color: colors.primary }]}>{t('au.forgot')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${t('au.noAccount')} ${t('au.register')}`}
        onPress={() => router.push('/(auth)/register')}
        style={styles.link}
      >
        <Text style={[Typography.body, { color: colors.textMuted }]}>
          {t('au.noAccount')} <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('au.register')}</Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  or: { textAlign: 'center' },
  link: { minHeight: MinTouch, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.one },
});
