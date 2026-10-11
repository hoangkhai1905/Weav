import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MailCheck } from 'lucide-react-native';
import { Button } from '../../../components/ui/Button';
import { TextField } from '../../../components/ui/TextField';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import { useUIStore } from '../../../stores/ui.store';
import { fill } from '../../common/fill';
import { invitationErrorKey, onlyCodeDigits } from '../invitation.helpers';
import { useEmailVerification } from '../hooks/useInvitations';

/**
 * Invitations stay hidden until the account's e-mail is verified: send a code, type the 6 digits.
 * When the check succeeds the invitation list reloads and this card disappears on its own.
 */
export const VerifyEmailCard: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const { sendCode, verify } = useEmailVerification();
  const [challengeId, setChallengeId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const handleSend = async () => {
    if (sendCode.isPending) return;
    setError(null);
    try {
      const receipt = await sendCode.mutateAsync();
      setChallengeId(receipt.challengeId);
      setCode('');
      setNote(fill(t('inv.verify.sent'), { minutes: Math.max(1, Math.ceil(receipt.expiresIn / 60)) }));
    } catch (e) {
      showToast({ type: 'error', title: t('inv.verify.sendFailTitle'), message: t(invitationErrorKey(e, 'verify')) });
    }
  };

  const handleVerify = async () => {
    if (!challengeId || code.length !== 6 || verify.isPending) return;
    setError(null);
    try {
      await verify.mutateAsync({ challengeId, code });
      showToast({ type: 'success', title: t('inv.verify.done') });
    } catch (e) {
      setError(t(invitationErrorKey(e, 'verify')));
    }
  };

  return (
    <View testID="invitations-verify" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.head}>
        <MailCheck size={20} color={colors.primary} />
        <Text accessibilityRole="header" style={[Typography.title, styles.title, { color: colors.text }]}>
          {t('inv.verify.title')}
        </Text>
      </View>
      <Text style={[Typography.body, { color: colors.textMuted }]}>{t('inv.verify.body')}</Text>
      {challengeId ? (
        <>
          {note ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{note}</Text> : null}
          <TextField
            testID="invitations-verify-code"
            label={t('inv.verify.codeLabel')}
            hint={t('inv.verify.codeHint')}
            value={code}
            onChangeText={(v) => {
              setCode(onlyCodeDigits(v));
              setError(null);
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            error={error}
          />
          <Button
            testID="invitations-verify-submit"
            label={t('inv.verify.submit')}
            busy={verify.isPending}
            disabled={code.length !== 6}
            onPress={() => void handleVerify()}
          />
          <Button
            variant="secondary"
            label={t('inv.verify.resend')}
            busy={sendCode.isPending}
            disabled={verify.isPending}
            onPress={() => void handleSend()}
          />
        </>
      ) : (
        <Button
          testID="invitations-verify-send"
          label={t('inv.verify.send')}
          busy={sendCode.isPending}
          onPress={() => void handleSend()}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1 },
});
