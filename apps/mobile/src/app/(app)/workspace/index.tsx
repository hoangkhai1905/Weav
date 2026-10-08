import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Building2, Check, LogOut, Plus, Search, UserPlus } from 'lucide-react-native';
import { useWorkspace } from '../../../features/workspace/hooks/useWorkspace';
import { useSwitchWorkspace } from '../../../features/workspace/hooks/useSwitchWorkspace';
import {
  canManageWorkspaceMember,
  createWorkspaceInput,
  isWorkspaceMemberMutationScopeCurrent,
  validateMemberEmail,
  validateWorkspaceName,
} from '../../../features/workspace/workspace.mutations';
import { MemberCard } from '../../../features/workspace/components/MemberCard';
import { normalizeSearch } from '../../../features/workflows/workflow.filter';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { localizeValidation } from '../../../features/common/validation-copy';
import type { WorkspaceMember } from '../../../domain/workspace/workspace.types';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Sheet } from '../../../components/ui/Sheet';
import { TextField } from '../../../components/ui/TextField';
import type { ApiError } from '../../../domain/common/error.types';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAuthStore } from '../../../stores/auth.store';
import { useUIStore } from '../../../stores/ui.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';

type Confirmation = { kind: 'remove'; member: WorkspaceMember } | { kind: 'leave' } | null;

/** Identifies "this user, this session, this workspace" so a late answer never touches another one. */
function captureScope() {
  const auth = useAuthStore.getState();
  return {
    userId: auth.user?.id ?? null,
    generation: auth.sessionGeneration,
    workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
  };
}

function scopeIsCurrent(scope: ReturnType<typeof captureScope>): boolean {
  const auth = useAuthStore.getState();
  return (
    scope.userId !== null &&
    scope.workspaceId !== null &&
    auth.sessionGeneration === scope.generation &&
    isWorkspaceMemberMutationScopeCurrent(
      scope.userId,
      scope.workspaceId,
      auth.user?.id ?? null,
      useWorkspaceStore.getState().activeWorkspaceId,
      auth.isAuthenticated,
    )
  );
}

export default function WorkspaceScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const switchWorkspace = useSwitchWorkspace();
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    members,
    isLoadingWorkspace,
    isLoadingMembers,
    workspaceError,
    membersError,
    workspaceAccessError,
    retryWorkspace,
    retryMembers,
    createWorkspaceMutation,
    renameWorkspaceMutation,
    addMemberMutation,
    updateMemberPermissionsMutation,
    removeMemberMutation,
    leaveWorkspaceMutation,
  } = useWorkspace();
  const sessionUserId = useAuthStore((s) => s.user?.id ?? null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState('');
  const [renameName, setRenameName] = React.useState('');
  const [memberEmail, setMemberEmail] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<Confirmation>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    setRenameName(activeWorkspace?.name ?? '');
    setRenameError(null);
    setMemberEmail('');
    setInviteError(null);
    setSearch('');
    setConfirmation(null);
  }, [activeWorkspace?.id, sessionUserId]);

  const me = members.find((m) => m.id === sessionUserId);
  const isOwner = canManageWorkspaceMember(me);
  const membersBusy =
    updateMemberPermissionsMutation.isPending || removeMemberMutation.isPending || leaveWorkspaceMutation.isPending;

  const visibleMembers = React.useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return members;
    return members.filter((m) => normalizeSearch(`${m.name} ${m.email}`).includes(q));
  }, [members, search]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  /** One request at a time; reports failure only if the user and workspace are still the same. */
  const guarded = async (run: () => Promise<void>, onError: (message: string) => void) => {
    if (busyRef.current) return;
    const scope = captureScope();
    if (!scope.userId || !scope.workspaceId) return;
    busyRef.current = true;
    try {
      await run();
    } catch (error) {
      if (scopeIsCurrent(scope)) onError(friendlyErrorMessage(error));
    } finally {
      busyRef.current = false;
    }
  };

  const handleCreate = async () => {
    const invalid = validateWorkspaceName(createName, false);
    if (invalid) return setCreateError(localizeValidation(invalid));
    setCreateError(null);
    if (busyRef.current || createWorkspaceMutation.isPending) return;
    busyRef.current = true;
    try {
      await createWorkspaceMutation.mutateAsync(createWorkspaceInput(createName));
      setCreateName('');
      setCreateOpen(false);
    } catch (error) {
      setCreateError(friendlyErrorMessage(error));
    } finally {
      busyRef.current = false;
    }
  };

  const handleRename = () =>
    guarded(
      async () => {
        const invalid = validateWorkspaceName(renameName, true);
        if (invalid) {
          setRenameError(localizeValidation(invalid));
          return;
        }
        setRenameError(null);
        const renamed = await renameWorkspaceMutation.mutateAsync({
          workspaceId: activeWorkspaceId as string,
          input: { name: renameName.trim() },
        });
        setRenameName(renamed.name);
      },
      setRenameError,
    );

  const handleInvite = () =>
    guarded(
      async () => {
        const invalid = validateMemberEmail(memberEmail);
        if (invalid) {
          setInviteError(localizeValidation(invalid));
          return;
        }
        setInviteError(null);
        await addMemberMutation.mutateAsync({ email: memberEmail.trim() });
        setMemberEmail('');
        setInviteOpen(false);
      },
      setInviteError,
    );

  const handleToggle = (member: WorkspaceMember, field: 'canPublishWorkflow' | 'canManageWorkflowState') =>
    guarded(
      async () => {
        await updateMemberPermissionsMutation.mutateAsync({
          workspaceId: activeWorkspaceId as string,
          userId: member.id,
          input: {
            canPublishWorkflow: field === 'canPublishWorkflow' ? !member.canPublishWorkflow : member.canPublishWorkflow,
            canManageWorkflowState:
              field === 'canManageWorkflowState' ? !member.canManageWorkflowState : member.canManageWorkflowState,
          },
        });
      },
      (message) => showToast({ type: 'error', title: t('ws.toast.permFailed'), message }),
    );

  const handleConfirm = () => {
    const action = confirmation;
    if (!action) return;
    void guarded(
      async () => {
        if (action.kind === 'remove') {
          await removeMemberMutation.mutateAsync({
            workspaceId: activeWorkspaceId as string,
            userId: action.member.id,
          });
        } else {
          await leaveWorkspaceMutation.mutateAsync(activeWorkspaceId as string);
        }
        setConfirmation(null);
      },
      (message) => {
        setConfirmation(null);
        showToast({
          type: 'error',
          title: t(action.kind === 'remove' ? 'ws.toast.removeFailed' : 'ws.toast.leaveFailed'),
          message,
        });
      },
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([retryWorkspace(), activeWorkspaceId ? retryMembers() : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  };

  const showSkeleton = isLoadingWorkspace && workspaces.length === 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={t('ws.title')}
        onBack={goBack}
        trailing={
          <Pressable
            testID="workspace-create-open"
            accessibilityRole="button"
            accessibilityLabel={t('ws.create')}
            onPress={() => setCreateOpen(true)}
            style={styles.iconBtn}
          >
            <Plus size={22} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {showSkeleton ? (
          <ListSkeleton rows={3} />
        ) : workspaceError && workspaces.length === 0 ? (
          <ErrorState error={workspaceError as unknown as ApiError} onRetry={() => void retryWorkspace()} />
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={<Building2 size={32} color={colors.textSubtle} />}
            title={t('ws.empty.title')}
            description={t('ws.empty.desc')}
            actionLabel={t('ws.create')}
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          <>
            <Text style={[Typography.label, { color: colors.textMuted }]}>{t('ws.pick')}</Text>
            <View testID="workspace-list" style={styles.list}>
              {workspaces.map((workspace) => {
                const selected = workspace.id === activeWorkspaceId;
                return (
                  <Pressable
                    key={workspace.id}
                    testID={`workspace-option-${workspace.id}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={workspace.name}
                    onPress={() => switchWorkspace(workspace.id)}
                    style={[
                      styles.option,
                      {
                        backgroundColor: selected ? colors.primaryBg : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Building2 size={20} color={selected ? colors.primary : colors.textSubtle} />
                    <Text style={[Typography.body, styles.optionName, { color: colors.text }]} numberOfLines={1}>
                      {workspace.name}
                    </Text>
                    {selected ? (
                      <View style={styles.selectedMark}>
                        <Check size={16} color={colors.primary} />
                        <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]}>
                          {t('ws.current')}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {workspaceAccessError ? (
              <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.warning }]}>
                {t('ws.unavailable')}
              </Text>
            ) : null}
          </>
        )}

        {activeWorkspace ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
              {t('ws.settings')}
            </Text>
            {isOwner ? (
              <>
                <TextField
                  testID="workspace-rename-name"
                  label={t('ws.rename.label')}
                  value={renameName}
                  onChangeText={(v) => {
                    setRenameName(v);
                    setRenameError(null);
                  }}
                  maxLength={255}
                  autoCapitalize="sentences"
                  error={renameError}
                />
                <Button
                  label={t('ws.rename.save')}
                  busy={renameWorkspaceMutation.isPending}
                  disabled={!renameName.trim() || renameName.trim() === activeWorkspace.name}
                  onPress={() => void handleRename()}
                />
              </>
            ) : (
              <Text style={[Typography.body, { color: colors.textMuted }]}>
                {me ? t('ws.memberNote') : t('ws.permLoading')}
              </Text>
            )}
          </View>
        ) : null}

        {activeWorkspaceId ? (
          <View testID="workspace-members-section" style={styles.membersWrap}>
            <View style={styles.membersHead}>
              <Text accessibilityRole="header" style={[Typography.title, styles.membersTitle, { color: colors.text }]}>
                {t('ws.members')} {members.length ? `(${members.length})` : ''}
              </Text>
              {isOwner ? (
                <Button
                  label={t('ws.invite')}
                  icon={<UserPlus size={16} color={colors.onPrimary} />}
                  onPress={() => setInviteOpen(true)}
                />
              ) : null}
            </View>

            {members.length > 1 ? (
              <TextField
                testID="workspace-member-search"
                label={t('ws.search.label')}
                placeholder={t('ws.search.placeholder')}
                icon={Search}
                value={search}
                onChangeText={setSearch}
              />
            ) : null}

            {isLoadingMembers && members.length === 0 ? (
              <ListSkeleton rows={3} />
            ) : membersError && members.length === 0 ? (
              <ErrorState error={membersError as unknown as ApiError} onRetry={() => void retryMembers()} />
            ) : members.length === 0 ? (
              <EmptyState title={t('ws.members.empty')} />
            ) : visibleMembers.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textMuted }]}>{t('ws.search.none')}</Text>
            ) : (
              <View testID="workspace-members-list" style={styles.list}>
                {visibleMembers.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    isSelf={member.id === sessionUserId}
                    canManage={isOwner}
                    busy={membersBusy}
                    onTogglePublish={() => void handleToggle(member, 'canPublishWorkflow')}
                    onToggleState={() => void handleToggle(member, 'canManageWorkflowState')}
                    onRemove={() => setConfirmation({ kind: 'remove', member })}
                  />
                ))}
              </View>
            )}

            {me && !isOwner ? (
              <Button
                variant="danger"
                label={t('ws.leave')}
                icon={<LogOut size={16} color={colors.danger} />}
                onPress={() => setConfirmation({ kind: 'leave' })}
              />
            ) : null}
            {isOwner ? (
              <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('ws.ownerCannotLeave')}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title={t('ws.create')}>
        <TextField
          testID="workspace-create-name"
          label={t('ws.create.nameLabel')}
          hint={t('ws.create.nameHint')}
          value={createName}
          onChangeText={(v) => {
            setCreateName(v);
            setCreateError(null);
          }}
          maxLength={255}
          autoCapitalize="sentences"
          error={createError}
        />
        <Button label={t('ws.create.submit')} busy={createWorkspaceMutation.isPending} onPress={() => void handleCreate()} />
      </Sheet>

      <Sheet visible={inviteOpen} onClose={() => setInviteOpen(false)} title={t('ws.invite')}>
        <Text style={[Typography.body, { color: colors.textMuted }]}>{t('ws.invite.desc')}</Text>
        <TextField
          testID="workspace-member-email"
          label={t('ws.invite.emailLabel')}
          placeholder="ten@congty.com"
          icon={UserPlus}
          keyboardType="email-address"
          maxLength={320}
          value={memberEmail}
          onChangeText={(v) => {
            setMemberEmail(v);
            setInviteError(null);
          }}
          error={inviteError}
        />
        <Button label={t('ws.invite.submit')} busy={addMemberMutation.isPending} onPress={() => void handleInvite()} />
      </Sheet>

      <ConfirmSheet
        visible={confirmation !== null}
        title={t(confirmation?.kind === 'leave' ? 'ws.leave.title' : 'ws.remove.title')}
        message={
          confirmation?.kind === 'remove'
            ? t('ws.remove.message').replace('{name}', confirmation.member.name || confirmation.member.email)
            : t('ws.leave.message').replace('{workspace}', activeWorkspace?.name ?? '')
        }
        confirmLabel={t(confirmation?.kind === 'leave' ? 'ws.leave' : 'ws.member.remove')}
        destructive
        busy={removeMemberMutation.isPending || leaveWorkspaceMutation.isPending}
        onConfirm={handleConfirm}
        onClose={() => setConfirmation(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.five },
  iconBtn: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  optionName: { flex: 1, fontWeight: '600' },
  selectedMark: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  card: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  membersWrap: { gap: Spacing.three },
  membersHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  membersTitle: { flexShrink: 1 },
});
