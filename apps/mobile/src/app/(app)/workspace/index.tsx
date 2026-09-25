import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Building2, RefreshCw } from 'lucide-react-native';
import { useWorkspace } from '../../../features/workspace/hooks/useWorkspace';
import {
  canSubmitWorkspaceMutation,
  canManageWorkspaceMember,
  createWorkspaceInput,
  isWorkspaceMemberMutationScopeCurrent,
  isWorkspaceMutationScopeCurrent,
  validateMemberEmail,
  validateWorkspaceName,
} from '../../../features/workspace/workspace.mutations';
import type { WorkspaceMember } from '../../../domain/workspace/workspace.types';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useAuthStore } from '../../../stores/auth.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';

function messageFor(error: unknown, fallback: string): string {
  const candidate = error as { message?: string } | null;
  return candidate?.message || fallback;
}

export default function WorkspaceScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    members,
    isLoadingWorkspace,
    isLoadingDetail,
    isLoadingMembers,
    workspaceError,
    detailError,
    membersError,
    workspaceAccessError,
    selectWorkspace,
    retryWorkspace,
    retryDetail,
    retryMembers,
    createWorkspaceMutation,
    renameWorkspaceMutation,
    addMemberMutation,
    updateMemberPermissionsMutation,
    removeMemberMutation,
    leaveWorkspaceMutation,
  } = useWorkspace();
  const sessionUserId = useAuthStore((state) => state.user?.id ?? null);
  const [createName, setCreateName] = React.useState('');
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = React.useState<string | null>(null);
  const [renameName, setRenameName] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = React.useState<string | null>(null);
  const [memberEmail, setMemberEmail] = React.useState('');
  const [memberError, setMemberError] = React.useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = React.useState<string | null>(null);
  const [memberActionError, setMemberActionError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<
    { kind: 'remove'; member: WorkspaceMember } | { kind: 'leave'; member: WorkspaceMember } | null
  >(null);
  const createSubmissionRef = React.useRef(false);
  const renameSubmissionRef = React.useRef(false);
  const memberSubmissionRef = React.useRef(false);

  React.useEffect(() => {
    setRenameName(activeWorkspace?.name ?? '');
    setRenameError(null);
    setRenameSuccess(null);
    setMemberEmail('');
    setMemberError(null);
    setMemberSuccess(null);
    setMemberActionError(null);
    setConfirmation(null);
  }, [activeWorkspace?.id, sessionUserId]);

  const currentMember = members.find((member) => member.id === sessionUserId);
  const canManageMembers = canManageWorkspaceMember(currentMember);

  const handleCreate = async () => {
    if (!canSubmitWorkspaceMutation(createWorkspaceMutation.isPending, createSubmissionRef.current)) return;

    const validationError = validateWorkspaceName(createName, false);
    if (validationError) {
      setCreateError(validationError);
      setCreateSuccess(null);
      return;
    }

    const mutationUserId = useAuthStore.getState().user?.id ?? null;
    if (!mutationUserId || !useAuthStore.getState().isAuthenticated) {
      setCreateError('Please sign in again before creating a workspace.');
      setCreateSuccess(null);
      return;
    }

    createSubmissionRef.current = true;
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const created = await createWorkspaceMutation.mutateAsync(createWorkspaceInput(createName));
      const auth = useAuthStore.getState();
      if (!isWorkspaceMutationScopeCurrent(mutationUserId, auth.user?.id ?? null, auth.isAuthenticated)) {
        return;
      }
      setCreateName('');
      setCreateSuccess(`Workspace “${created.name}” created.`);
    } catch (error) {
      const auth = useAuthStore.getState();
      if (isWorkspaceMutationScopeCurrent(mutationUserId, auth.user?.id ?? null, auth.isAuthenticated)) {
        setCreateError(messageFor(error, 'Unable to create this workspace.'));
        setCreateSuccess(null);
      }
    } finally {
      createSubmissionRef.current = false;
    }
  };

  const handleRename = async () => {
    if (!activeWorkspaceId || !canSubmitWorkspaceMutation(renameWorkspaceMutation.isPending, renameSubmissionRef.current)) return;

    const validationError = validateWorkspaceName(renameName, true);
    if (validationError) {
      setRenameError(validationError);
      setRenameSuccess(null);
      return;
    }

    const mutationUserId = useAuthStore.getState().user?.id ?? null;
    const mutationWorkspaceId = activeWorkspaceId;
    if (!mutationUserId || !useAuthStore.getState().isAuthenticated) {
      setRenameError('Please sign in again before renaming a workspace.');
      setRenameSuccess(null);
      return;
    }

    renameSubmissionRef.current = true;
    setRenameError(null);
    setRenameSuccess(null);

    try {
      const renamed = await renameWorkspaceMutation.mutateAsync({
        workspaceId: mutationWorkspaceId,
        input: { name: renameName.trim() },
      });
      const auth = useAuthStore.getState();
      if (!isWorkspaceMutationScopeCurrent(mutationUserId, auth.user?.id ?? null, auth.isAuthenticated)) {
        return;
      }
      setRenameName(renamed.name);
      setRenameSuccess('Workspace name updated.');
    } catch (error) {
      const auth = useAuthStore.getState();
      if (isWorkspaceMutationScopeCurrent(mutationUserId, auth.user?.id ?? null, auth.isAuthenticated)) {
        setRenameError(messageFor(error, 'Unable to rename this workspace.'));
        setRenameSuccess(null);
      }
    } finally {
      renameSubmissionRef.current = false;
    }
  };

  const handleAddMember = async () => {
    if (!activeWorkspaceId || !canManageMembers || memberSubmissionRef.current || addMemberMutation.isPending) return;
    const validationError = validateMemberEmail(memberEmail);
    if (validationError) {
      setMemberError(validationError);
      setMemberSuccess(null);
      return;
    }
    const mutationUserId = useAuthStore.getState().user?.id ?? null;
    const mutationWorkspaceId = activeWorkspaceId;
    if (!mutationUserId || !useAuthStore.getState().isAuthenticated) {
      setMemberError('Please sign in again before adding a member.');
      setMemberSuccess(null);
      return;
    }

    memberSubmissionRef.current = true;
    setMemberError(null);
    setMemberSuccess(null);
    try {
      const added = await addMemberMutation.mutateAsync({ email: memberEmail.trim() });
      const auth = useAuthStore.getState();
      if (!isWorkspaceMemberMutationScopeCurrent(
        mutationUserId,
        mutationWorkspaceId,
        auth.user?.id ?? null,
        useWorkspaceStore.getState().activeWorkspaceId,
        auth.isAuthenticated,
      )) return;
      setMemberEmail('');
      setMemberSuccess(`${added.name} was added to this workspace.`);
    } catch (error) {
      const auth = useAuthStore.getState();
      if (isWorkspaceMemberMutationScopeCurrent(
        mutationUserId,
        mutationWorkspaceId,
        auth.user?.id ?? null,
        useWorkspaceStore.getState().activeWorkspaceId,
        auth.isAuthenticated,
      )) {
        setMemberError(messageFor(error, 'Unable to add this member.'));
        setMemberSuccess(null);
      }
    } finally {
      memberSubmissionRef.current = false;
    }
  };

  const handlePermissionToggle = async (member: WorkspaceMember, field: 'canPublishWorkflow' | 'canManageWorkflowState') => {
    if (!activeWorkspaceId || !canManageMembers || member.role === 'OWNER' || updateMemberPermissionsMutation.isPending) return;
    const mutationUserId = useAuthStore.getState().user?.id ?? null;
    const mutationWorkspaceId = activeWorkspaceId;
    if (!mutationUserId || !useAuthStore.getState().isAuthenticated) return;
    setMemberActionError(null);
    try {
      await updateMemberPermissionsMutation.mutateAsync({
        workspaceId: mutationWorkspaceId,
        userId: member.id,
        input: {
          canPublishWorkflow: field === 'canPublishWorkflow' ? !member.canPublishWorkflow : member.canPublishWorkflow,
          canManageWorkflowState: field === 'canManageWorkflowState' ? !member.canManageWorkflowState : member.canManageWorkflowState,
        },
      });
    } catch (error) {
      const auth = useAuthStore.getState();
      if (
        isWorkspaceMutationScopeCurrent(mutationUserId, auth.user?.id ?? null, auth.isAuthenticated) &&
        useWorkspaceStore.getState().activeWorkspaceId === mutationWorkspaceId
      ) {
        setMemberActionError(messageFor(error, 'Unable to update member permissions.'));
      }
    }
  };

  const handleConfirmMemberAction = async () => {
    if (!confirmation || !activeWorkspaceId || memberSubmissionRef.current) return;
    const action = confirmation;
    const mutationUserId = useAuthStore.getState().user?.id ?? null;
    const mutationWorkspaceId = activeWorkspaceId;
    if (!mutationUserId || !useAuthStore.getState().isAuthenticated) {
      setMemberActionError('Please sign in again before changing workspace members.');
      setConfirmation(null);
      return;
    }

    memberSubmissionRef.current = true;
    setMemberActionError(null);
    try {
      if (action.kind === 'remove') {
        await removeMemberMutation.mutateAsync({ workspaceId: mutationWorkspaceId, userId: action.member.id });
      } else {
        await leaveWorkspaceMutation.mutateAsync(mutationWorkspaceId);
      }
      const auth = useAuthStore.getState();
      if (isWorkspaceMemberMutationScopeCurrent(
        mutationUserId,
        mutationWorkspaceId,
        auth.user?.id ?? null,
        useWorkspaceStore.getState().activeWorkspaceId,
        auth.isAuthenticated,
      )) {
        setConfirmation(null);
      }
    } catch (error) {
      const auth = useAuthStore.getState();
      if (isWorkspaceMemberMutationScopeCurrent(
        mutationUserId,
        mutationWorkspaceId,
        auth.user?.id ?? null,
        useWorkspaceStore.getState().activeWorkspaceId,
        auth.isAuthenticated,
      )) {
        setMemberActionError(messageFor(error, action.kind === 'remove' ? 'Unable to remove this member.' : 'Unable to leave this workspace.'));
      }
    } finally {
      memberSubmissionRef.current = false;
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  const showInitialLoading = isLoadingWorkspace && workspaces.length === 0;
  const showInitialError = Boolean(workspaceError) && workspaces.length === 0;
  const showEmpty = !isLoadingWorkspace && !workspaceError && workspaces.length === 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          style={styles.backBtn}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Workspaces</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose workspace</Text>
          <Text style={[styles.sectionHint, { color: colors.textSubtle }]}>Only workspaces returned by your account are selectable.</Text>
        </View>

        {showInitialLoading && (
          <View testID="workspace-loading" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statusText, { color: colors.textMuted }]}>Loading workspaces…</Text>
          </View>
        )}

        {showInitialError && (
          <View testID="workspace-error" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statusText, { color: colors.danger || colors.text }]}>
              {messageFor(workspaceError, 'Unable to load workspaces.')}
            </Text>
            <RetryButton onPress={retryWorkspace} colors={colors} testID="workspace-retry" />
          </View>
        )}

        {showEmpty && (
          <View testID="workspace-empty" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statusText, { color: colors.textMuted }]}>No workspaces are available for this account.</Text>
            <RetryButton onPress={retryWorkspace} colors={colors} testID="workspace-empty-retry" />
          </View>
        )}

        {workspaces.length > 0 && (
          <View testID="workspace-list" style={styles.workspaceList}>
            {workspaces.map((workspace) => {
              const selected = workspace.id === activeWorkspaceId;
              return (
                <Pressable
                  key={workspace.id}
                  testID={`workspace-option-${workspace.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => selectWorkspace(workspace.id)}
                  style={[
                    styles.workspaceOption,
                    { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border },
                  ]}
                >
                  <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
                    <Building2 color={selected ? colors.primary : colors.textSubtle} size={20} />
                  </View>
                  <View style={styles.workspaceOptionText}>
                    <Text style={[styles.workspaceName, { color: colors.text }]}>{workspace.name}</Text>
                    <Text style={[styles.workspaceId, { color: colors.textSubtle }]}>{workspace.id}</Text>
                  </View>
                  {selected && <Text style={[styles.selectedLabel, { color: colors.primary }]}>Selected</Text>}
                </Pressable>
              );
            })}
          </View>
        )}

        {workspaceAccessError && (
          <View testID="workspace-selection-error" style={[styles.noticeCard, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
            <Text style={[styles.noticeText, { color: colors.textMuted }]}>{workspaceAccessError}</Text>
          </View>
        )}

        <View testID="workspace-mutations" style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Workspace settings</Text>
          <Text style={[styles.sectionHint, { color: colors.textSubtle }]}>Create a workspace or rename the selected workspace.</Text>

          <Text style={[styles.formLabel, { color: colors.text }]}>New workspace name (optional)</Text>
          <TextInput
            testID="workspace-create-name"
            value={createName}
            onChangeText={(value) => {
              setCreateName(value);
              setCreateError(null);
            }}
            placeholder="Workspace name"
            placeholderTextColor={colors.textSubtle}
            maxLength={255}
            editable={!createWorkspaceMutation.isPending}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
          />
          <Pressable
            testID="workspace-create-submit"
            onPress={handleCreate}
            disabled={createWorkspaceMutation.isPending}
            accessibilityRole="button"
            style={[styles.formButton, { backgroundColor: colors.primary }, createWorkspaceMutation.isPending && styles.disabledButton]}
          >
            <Text style={styles.formButtonText}>{createWorkspaceMutation.isPending ? 'Creating…' : 'Create workspace'}</Text>
          </Pressable>
          {createError && <Text testID="workspace-create-error" accessibilityRole="alert" style={[styles.formError, { color: colors.danger || colors.text }]}>{createError}</Text>}
          {createSuccess && <Text testID="workspace-create-success" style={[styles.successText, { color: colors.primary }]}>{createSuccess}</Text>}

          {activeWorkspace && (
            <>
              <Text style={[styles.formLabel, { color: colors.text }]}>Rename selected workspace</Text>
              <TextInput
                testID="workspace-rename-name"
                value={renameName}
                onChangeText={(value) => {
                  setRenameName(value);
                  setRenameError(null);
                }}
                placeholder="Workspace name"
                placeholderTextColor={colors.textSubtle}
                maxLength={255}
                editable={!renameWorkspaceMutation.isPending}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
              />
              <Pressable
                testID="workspace-rename-submit"
                onPress={handleRename}
                disabled={renameWorkspaceMutation.isPending}
                accessibilityRole="button"
                style={[styles.formButton, { backgroundColor: colors.primary }, renameWorkspaceMutation.isPending && styles.disabledButton]}
              >
                <Text style={styles.formButtonText}>{renameWorkspaceMutation.isPending ? 'Saving…' : 'Save workspace name'}</Text>
              </Pressable>
              {renameError && <Text testID="workspace-rename-error" accessibilityRole="alert" style={[styles.formError, { color: colors.danger || colors.text }]}>{renameError}</Text>}
              {renameSuccess && <Text testID="workspace-rename-success" style={[styles.successText, { color: colors.primary }]}>{renameSuccess}</Text>}
            </>
          )}
        </View>

        {activeWorkspace && (
          <View testID="workspace-current" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.wsHeader}>
              <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
                <Building2 color={colors.primary} size={22} />
              </View>
              <View style={styles.wsTitleGroup}>
                <Text testID="workspace-current-name" style={[styles.wsName, { color: colors.text }]}>{activeWorkspace.name}</Text>
                <Text testID="workspace-current-id" style={[styles.wsOwner, { color: colors.textSubtle }]}>{activeWorkspace.id}</Text>
              </View>
            </View>
            {isLoadingDetail && (
              <Text testID="workspace-detail-loading" style={[styles.statusText, { color: colors.textMuted }]}>Refreshing workspace details…</Text>
            )}
            {detailError && (
              <View testID="workspace-detail-error" style={styles.inlineError}>
                <Text style={[styles.statusText, { color: colors.danger || colors.text }]}>{messageFor(detailError, 'Unable to load workspace details.')}</Text>
                <RetryButton onPress={retryDetail} colors={colors} testID="workspace-detail-retry" />
              </View>
            )}
            <View testID="workspace-member-management" style={[styles.webManageBox, { backgroundColor: colors.cardSecondary }]}>
              <Text style={[styles.webManageText, { color: colors.textMuted }]}>Only the workspace owner can manage members. The server remains the final authority.</Text>
              {!currentMember && (
                <Text testID="workspace-member-capability-loading" style={[styles.webManageText, { color: colors.textSubtle }]}>Your member permissions are still loading; management is disabled.</Text>
              )}
              {currentMember && currentMember.role === 'MEMBER' && (
                <Text testID="workspace-member-capability-denied" style={[styles.webManageText, { color: colors.textSubtle }]}>You can view members, but only the owner can change membership.</Text>
              )}
              {canManageMembers && (
                <>
                  <Text style={[styles.formLabel, { color: colors.text }]}>Add existing user by email</Text>
                  <TextInput
                    testID="workspace-member-email"
                    value={memberEmail}
                    onChangeText={(value) => {
                      setMemberEmail(value);
                      setMemberError(null);
                    }}
                    placeholder="Existing account email"
                    placeholderTextColor={colors.textSubtle}
                    maxLength={320}
                    editable={!addMemberMutation.isPending && !memberSubmissionRef.current}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  />
                  <Pressable
                    testID="workspace-member-add-submit"
                    onPress={handleAddMember}
                    disabled={addMemberMutation.isPending || memberSubmissionRef.current}
                    style={[styles.formButton, { backgroundColor: colors.primary }, (addMemberMutation.isPending || memberSubmissionRef.current) && styles.disabledButton]}
                  >
                    <Text style={styles.formButtonText}>{addMemberMutation.isPending ? 'Adding…' : 'Add member'}</Text>
                  </Pressable>
                  {memberError && <Text testID="workspace-member-error" accessibilityRole="alert" style={[styles.formError, { color: colors.danger || colors.text }]}>{memberError}</Text>}
                  {memberSuccess && <Text testID="workspace-member-success" style={[styles.successText, { color: colors.primary }]}>{memberSuccess}</Text>}
                </>
              )}
            </View>
          </View>
        )}

        {activeWorkspaceId && (
          <View testID="workspace-members-section" style={styles.membersSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Workspace members</Text>
              <Text style={[styles.sectionHint, { color: colors.textSubtle }]}>Members and workflow permissions for the selected workspace.</Text>
            </View>

            {memberActionError && (
              <Text testID="workspace-member-action-error" accessibilityRole="alert" style={[styles.formError, { color: colors.danger || colors.text }]}>{memberActionError}</Text>
            )}

            {isLoadingMembers && (
              <View testID="workspace-members-loading" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statusText, { color: colors.textMuted }]}>Loading members…</Text>
              </View>
            )}

            {membersError && !isLoadingMembers && (
              <View testID="workspace-members-error" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statusText, { color: colors.danger || colors.text }]}>{messageFor(membersError, 'Unable to load workspace members.')}</Text>
                <RetryButton onPress={retryMembers} colors={colors} testID="workspace-members-retry" />
              </View>
            )}

            {!isLoadingMembers && !membersError && members.length === 0 && (
              <View testID="workspace-members-empty" style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statusText, { color: colors.textMuted }]}>No members found.</Text>
              </View>
            )}

            {!isLoadingMembers && !membersError && members.length > 0 && (
              <View testID="workspace-members-list" style={styles.membersList}>
                {members.map((member) => (
                  <View key={member.id} testID={`workspace-member-${member.id}`} style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                      <Text style={styles.avatarText}>{member.name.slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberHeader}>
                        <Text style={[styles.memberName, { color: colors.text }]}>{member.name}</Text>
                        <View style={[styles.roleBadge, { backgroundColor: colors.cardSecondary }, member.role === 'OWNER' && { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder, borderWidth: 1 }]}>
                          <Text style={[styles.roleText, { color: colors.textSubtle }, member.role === 'OWNER' && { color: colors.primary }]}>{member.role}</Text>
                        </View>
                      </View>
                      <Text style={[styles.memberEmail, { color: colors.textSubtle }]}>{member.email}</Text>
                      <Text style={[styles.memberPermission, { color: colors.primary }]}>Publishing: {member.canPublishWorkflow ? '✓ Allowed' : '✕ Restricted'}</Text>
                      <Text style={[styles.memberPermission, { color: colors.primary }]}>Workflow state: {member.canManageWorkflowState ? '✓ Allowed' : '✕ Restricted'}</Text>
                      {canManageMembers && member.role !== 'OWNER' && (
                        <View testID={`workspace-member-controls-${member.id}`} style={styles.memberControls}>
                          <Pressable
                            testID={`workspace-member-publish-${member.id}`}
                            onPress={() => void handlePermissionToggle(member, 'canPublishWorkflow')}
                            disabled={updateMemberPermissionsMutation.isPending}
                            style={[styles.memberActionButton, { borderColor: colors.primary }, updateMemberPermissionsMutation.isPending && styles.disabledButton]}
                          >
                            <Text style={[styles.memberActionText, { color: colors.primary }]}>{member.canPublishWorkflow ? 'Disable publish' : 'Allow publish'}</Text>
                          </Pressable>
                          <Pressable
                            testID={`workspace-member-state-${member.id}`}
                            onPress={() => void handlePermissionToggle(member, 'canManageWorkflowState')}
                            disabled={updateMemberPermissionsMutation.isPending}
                            style={[styles.memberActionButton, { borderColor: colors.primary }, updateMemberPermissionsMutation.isPending && styles.disabledButton]}
                          >
                            <Text style={[styles.memberActionText, { color: colors.primary }]}>{member.canManageWorkflowState ? 'Disable state' : 'Allow state'}</Text>
                          </Pressable>
                          <Pressable
                            testID={`workspace-member-remove-${member.id}`}
                            onPress={() => setConfirmation({ kind: 'remove', member })}
                            disabled={removeMemberMutation.isPending || memberSubmissionRef.current}
                            style={[styles.memberActionButton, { borderColor: colors.danger }, (removeMemberMutation.isPending || memberSubmissionRef.current) && styles.disabledButton]}
                          >
                            <Text style={[styles.memberActionText, { color: colors.danger }]}>Remove</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {currentMember && (
              <View testID="workspace-member-self-actions" style={[styles.selfActionBox, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.webManageText, { color: colors.textMuted }]}>Your role: {currentMember.role}. Leaving removes your access to this workspace.</Text>
                <Pressable
                  testID="workspace-member-leave"
                  onPress={() => setConfirmation({ kind: 'leave', member: currentMember })}
                  disabled={currentMember.role === 'OWNER' || leaveWorkspaceMutation.isPending || memberSubmissionRef.current}
                  style={[styles.memberActionButton, { borderColor: currentMember.role === 'OWNER' ? colors.border : colors.danger }, (currentMember.role === 'OWNER' || leaveWorkspaceMutation.isPending || memberSubmissionRef.current) && styles.disabledButton]}
                >
                  <Text style={[styles.memberActionText, { color: currentMember.role === 'OWNER' ? colors.textSubtle : colors.danger }]}>{currentMember.role === 'OWNER' ? 'Owner cannot leave' : 'Leave workspace'}</Text>
                </Pressable>
              </View>
            )}

            {confirmation && (
              <View testID="workspace-member-confirm" style={[styles.confirmBox, { backgroundColor: colors.card, borderColor: colors.danger }]}>
                <Text style={[styles.confirmText, { color: colors.text }]}>
                  {confirmation.kind === 'remove'
                    ? `Remove ${confirmation.member.name} from ${activeWorkspace?.name ?? 'this workspace'}?`
                    : `Leave ${activeWorkspace?.name ?? 'this workspace'}? You will lose access to its members and workflows.`}
                </Text>
                <View style={styles.memberControls}>
                  <Pressable testID="workspace-member-confirm-cancel" onPress={() => setConfirmation(null)} style={[styles.memberActionButton, { borderColor: colors.border }]}>
                    <Text style={[styles.memberActionText, { color: colors.textMuted }]}>Cancel</Text>
                  </Pressable>
                  <Pressable testID="workspace-member-confirm-submit" onPress={() => void handleConfirmMemberAction()} disabled={memberSubmissionRef.current} style={[styles.memberActionButton, { borderColor: colors.danger }, memberSubmissionRef.current && styles.disabledButton]}>
                    <Text style={[styles.memberActionText, { color: colors.danger }]}>{memberSubmissionRef.current ? 'Working…' : confirmation.kind === 'remove' ? 'Confirm remove' : 'Confirm leave'}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RetryButton({ onPress, colors, testID }: { onPress: () => void | Promise<void>; colors: ReturnType<typeof useThemeColors>; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.retryButton, { borderColor: colors.primary }]}>
      <RefreshCw color={colors.primary} size={14} />
      <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  sectionHeader: { gap: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  sectionHint: { fontSize: 12, lineHeight: 17 },
  workspaceList: { gap: 10 },
  workspaceOption: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  workspaceOptionText: { flex: 1, gap: 3 },
  workspaceName: { fontSize: 15, fontWeight: '800' },
  workspaceId: { fontSize: 10 },
  selectedLabel: { fontSize: 11, fontWeight: '800' },
  statusCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  statusText: { fontSize: 13, lineHeight: 19 },
  noticeCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  noticeText: { fontSize: 12, lineHeight: 18 },
  retryButton: { alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  retryText: { fontSize: 12, fontWeight: '800' },
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  wsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  wsTitleGroup: { flex: 1 },
  wsName: { fontSize: 18, fontWeight: '900' },
  wsOwner: { fontSize: 12, marginTop: 2 },
  webManageBox: { borderRadius: 12, padding: 12, marginTop: 4 },
  webManageText: { fontSize: 11, fontStyle: 'italic' },
  membersSection: { gap: 12 },
  membersList: { gap: 10 },
  memberCard: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  memberInfo: { flex: 1, gap: 2 },
  memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberName: { fontSize: 14, fontWeight: '700' },
  memberEmail: { fontSize: 11 },
  memberPermission: { fontSize: 10, marginTop: 2 },
  memberControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  memberActionButton: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  memberActionText: { fontSize: 11, fontWeight: '800' },
  selfActionBox: { borderRadius: 12, padding: 12, gap: 8, marginTop: 4 },
  confirmBox: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 10, marginTop: 4 },
  confirmText: { fontSize: 12, lineHeight: 18 },
  roleBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: '800' },
  inlineError: { gap: 8 },
  formCard: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10 },
  formLabel: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  formButton: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center' },
  disabledButton: { opacity: 0.6 },
  formButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  formError: { fontSize: 12, lineHeight: 17 },
  successText: { fontSize: 12, lineHeight: 17 },
});
