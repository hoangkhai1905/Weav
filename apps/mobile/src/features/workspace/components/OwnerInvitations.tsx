import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Mail, RotateCw, Undo2 } from 'lucide-react-native';
import type { OwnerInvitation, InvitationStatus } from '../../../domain/workspace/workspace.types';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { StatusTone } from '../../../constants/palette';
import { useUIStore } from '../../../stores/ui.store';
import { fill } from '../../common/fill';
import { formatRelativeTime } from '../../common/time';
import { invitationErrorKey } from '../invitation.helpers';
import { useInvitationActions, useOwnerInvitations } from '../hooks/useInvitations';

const STATUS_TONE: Record<InvitationStatus, StatusTone> = {
  PENDING: 'info',
  EXPIRED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  REVOKED: 'neutral',
};

/** "Pending invitations" of the active workspace (owner only). Renders nothing while the list is empty. */
export const OwnerInvitations: React.FC = () => {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const query = useOwnerInvitations(true);
  const { resend, revoke } = useInvitationActions();
  const [revokeTarget, setRevokeTarget] = React.useState<OwnerInvitation | null>(null);
  const busy = resend.isPending || revoke.isPending;
  const items = query.data ?? [];

  const fail = (error: unknown) =>
    showToast({ type: 'error', title: t('inv.owner.failTitle'), message: t(invitationErrorKey(error, 'manage')) });

  const handleResend = async (invitation: OwnerInvitation) => {
    if (busy) return;
    try {
      await resend.mutateAsync({ workspaceId: invitation.workspaceId, invitationId: invitation.id });
      showToast({ type: 'success', title: t('inv.owner.resent') });
    } catch (error) {
      fail(error);
    }
  };

  const handleRevoke = async () => {
    const invitation = revokeTarget;
    if (!invitation || busy) return;
    try {
      await revoke.mutateAsync({ workspaceId: invitation.workspaceId, invitationId: invitation.id });
      showToast({ type: 'success', title: t('inv.owner.revoked') });
    } catch (error) {
      fail(error);
    } finally {
      setRevokeTarget(null);
    }
  };

  if (query.isError && items.length === 0) {
    return (
      <View testID="workspace-invitations-error" style={styles.wrap}>
        <Text accessibilityRole="alert" style={[Typography.body, { color: colors.warning }]}>
          {t('inv.owner.loadFailed')}
        </Text>
        <Button variant="secondary" label={t('ui.retry')} onPress={() => void query.refetch()} />
      </View>
    );
  }
  if (items.length === 0) return null;

  return (
    <View testID="workspace-invitations" style={styles.wrap}>
      <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
        {t('inv.owner.title')}
      </Text>
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('inv.owner.help')}</Text>
      <View style={styles.list}>
        {items.map((invitation) => {
          const tone = colors.tones[STATUS_TONE[invitation.status]];
          const pending = invitation.status === 'PENDING';
          return (
            <View
              key={invitation.id}
              testID={`workspace-invitation-${invitation.id}`}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.top}>
                <Mail size={18} color={colors.textMuted} />
                <Text style={[Typography.body, styles.email, { color: colors.text }]} numberOfLines={1}>
                  {invitation.email}
                </Text>
                <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                  <Text style={[Typography.caption, { color: tone.fg, fontWeight: '600' }]}>
                    {t(`inv.owner.status.${invitation.status}`)}
                  </Text>
                </View>
              </View>
              {pending ? (
                <Text style={[Typography.caption, { color: colors.textMuted }]}>
                  {fill(t('inv.expires'), { when: formatRelativeTime(invitation.expiresAt, language) })}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {pending ? (
                  <View style={styles.action}>
                    <Button
                      variant="secondary"
                      label={t('inv.owner.resend')}
                      icon={<RotateCw size={16} color={colors.text} />}
                      busy={resend.isPending && resend.variables?.invitationId === invitation.id}
                      disabled={busy}
                      accessibilityHint={invitation.email}
                      onPress={() => void handleResend(invitation)}
                    />
                  </View>
                ) : null}
                <View style={styles.action}>
                  <Button
                    variant="danger"
                    label={t('inv.owner.revoke')}
                    icon={<Undo2 size={16} color={colors.danger} />}
                    disabled={busy}
                    accessibilityHint={invitation.email}
                    onPress={() => setRevokeTarget(invitation)}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <ConfirmSheet
        visible={revokeTarget !== null}
        title={t('inv.owner.revoke.title')}
        message={fill(t('inv.owner.revoke.message'), { email: revokeTarget?.email ?? '' })}
        confirmLabel={t('inv.owner.revoke')}
        destructive
        busy={revoke.isPending}
        onConfirm={() => void handleRevoke()}
        onClose={() => setRevokeTarget(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  list: { gap: Spacing.two },
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  email: { flex: 1, fontWeight: '600' },
  pill: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderWidth: 1, borderRadius: Radius.sm },
  actions: { flexDirection: 'row', gap: Spacing.two, minHeight: MinTouch },
  action: { flex: 1 },
});
