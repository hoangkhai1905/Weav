import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, Mail, User, UserPlus } from 'lucide-react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { beginAuthOperation, establishAuthSession } from '../../features/auth/auth-session.runtime';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePasswordRecovery } from '../../features/auth/password-recovery.utils';
import { fieldErrorsFromError } from '../../features/common/field-errors';
import { localizeValidation } from '../../features/common/validation-copy';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { AuthShell } from '../../components/ui/AuthShell';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

type Errors = { name?: string; email?: string; password?: string };

function generalErrorKey(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 409 || status === 429 || status === 400 ? `au.err.${status}` : 'au.err.network';
}

export default function RegisterScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = (): Errors => {
    const next: Errors = {};
    if (!name.trim()) next.name = t('au.err.nameRequired');
    const emailError = validatePasswordRecovery({ email, code: '123456', newPassword: 'valid-password', confirmPassword: 'valid-password' }).email;
    if (emailError) next.email = localizeValidation(emailError) ?? undefined;
    if (!password) next.password = t('au.err.passwordRequired');
    else if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) next.password = t('au.err.passwordLength');
    return next;
  };

  const handleRegister = async () => {
    const found = validate();
    setErrors(found);
    setGeneral(null);
    if (found.name || found.email || found.password) return;
    setLoading(true);
    const operation = beginAuthOperation();
    try {
      const session = await authRepository.register(email, name, password);
      const applied = await establishAuthSession(session, operation);
      if (!applied) return;
      router.replace('/(app)/(tabs)');
    } catch (err: unknown) {
      const fields = fieldErrorsFromError(err);
      setErrors({ name: fields.displayName, email: fields.email, password: fields.password });
      setGeneral(t(generalErrorKey(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('au.register.title')} subtitle={t('au.register.subtitle')}>
      <TextField
        label={t('au.name')}
        icon={User}
        value={name}
        onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: undefined })); }}
        error={errors.name}
        placeholder={t('au.namePlaceholder')}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
      />
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
        hint={t('au.passwordHint')}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => { void handleRegister(); }}
      />
      {general ? (
        <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>{general}</Text>
      ) : null}
      <Button label={t('au.register.submit')} icon={<UserPlus size={18} color={colors.onPrimary} />} busy={loading} onPress={() => { void handleRegister(); }} />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${t('au.haveAccount')} ${t('au.signInLink')}`}
        onPress={() => router.push('/(auth)/login')}
        style={styles.link}
      >
        <Text style={[Typography.body, { color: colors.textMuted }]}>
          {t('au.haveAccount')} <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('au.signInLink')}</Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: MinTouch, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.one },
});
