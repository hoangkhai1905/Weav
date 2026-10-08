import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { UserMinus } from 'lucide-react-native';
import type { WorkspaceMember } from '../../../domain/workspace/workspace.types';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { SwitchRow } from '../../../components/ui/SwitchRow';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Radius, Spacing, Typography } from '../../../constants/theme';

interface MemberCardProps {
  member: WorkspaceMember;
  isSelf: boolean;
  /** The signed-in user owns the workspace: only then are the controls shown. */
  canManage: boolean;
  busy: boolean;
  onTogglePublish: () => void;
  onToggleState: () => void;
  onRemove: () => void;
}

export const MemberCard: React.FC<MemberCardProps> = ({
  member,
  isSelf,
  canManage,
  busy,
  onTogglePublish,
  onToggleState,
  onRemove,
}) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const owner = member.role === 'OWNER';
  const name = member.name || member.email;
  const editable = canManage && !owner;
  return (
    <View testID={`workspace-member-${member.id}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.top}>
        <Avatar name={name} />
        <View style={styles.who}>
          <Text style={[Typography.body, styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
            {isSelf ? ` (${t('ws.you')})` : ''}
          </Text>
          <Text style={[Typography.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {member.email}
          </Text>
        </View>
        <View
          style={[
            styles.role,
            owner
              ? { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }
              : { backgroundColor: colors.cardSecondary, borderColor: colors.border },
          ]}
        >
          <Text style={[Typography.caption, { color: owner ? colors.primary : colors.textMuted, fontWeight: '700' }]}>
            {t(owner ? 'ws.role.owner' : 'ws.role.member')}
          </Text>
        </View>
      </View>

      {editable ? (
        <View style={styles.controls}>
          <SwitchRow
            testID={`workspace-member-publish-${member.id}`}
            label={t('ws.perm.publish')}
            hint={t('ws.perm.publishHint')}
            value={member.canPublishWorkflow}
            disabled={busy}
            onChange={onTogglePublish}
          />
          <SwitchRow
            testID={`workspace-member-state-${member.id}`}
            label={t('ws.perm.state')}
            hint={t('ws.perm.stateHint')}
            value={member.canManageWorkflowState}
            disabled={busy}
            onChange={onToggleState}
          />
          <Button
            variant="danger"
            label={t('ws.member.remove')}
            icon={<UserMinus size={16} color={colors.danger} />}
            disabled={busy}
            onPress={onRemove}
          />
        </View>
      ) : (
        <Text style={[Typography.caption, { color: colors.textMuted }]}>
          {owner
            ? t('ws.perm.ownerAll')
            : `${t(member.canPublishWorkflow ? 'ws.perm.canPublish' : 'ws.perm.cannotPublish')} · ${t(
                member.canManageWorkflowState ? 'ws.perm.canState' : 'ws.perm.cannotState',
              )}`}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  who: { flex: 1, gap: Spacing.half },
  name: { fontWeight: '600' },
  role: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderWidth: 1, borderRadius: Radius.pill },
  controls: { gap: Spacing.one, paddingTop: Spacing.one },
});
