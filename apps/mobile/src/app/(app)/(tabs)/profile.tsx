import React from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Camera, ChevronRight, Lock, LogOut, Mail, MessageSquare, PlugZap } from 'lucide-react-native';
import { useProfile } from '../../../features/profile/hooks/useProfile';
import { useAvatarUrl, useDeleteAvatar, useUploadAvatar } from '../../../features/profile/hooks/useAccount';
import { useMyInvitations } from '../../../features/workspace/hooks/useInvitations';
import { logoutAuthSession } from '../../../features/auth/auth-session.runtime';
import { fill } from '../../../features/common/fill';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { checkAvatarImage } from '../../../features/profile/avatar.utils';
import { localizeValidation } from '../../../features/common/validation-copy';
import { Avatar, initialsOf } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { HeaderActions } from '../../../components/ui/HeaderActions';
import { type ChipOption } from '../../../components/ui/FilterChips';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { StepTile, StepTileText } from '../../../components/ui/StepTile';
import { TextField } from '../../../components/ui/TextField';
import { FontFamily, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { StepKind } from '../../../constants/palette';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import type { Language } from '../../../stores/i18n.store';
import { selectActiveWorkspace, useWorkspaceStore } from '../../../stores/workspace.store';
import { useAuthStore } from '../../../stores/auth.store';
import { useUIStore, type ThemeMode } from '../../../stores/ui.store';

export default function ProfileScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language, setLanguage } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const showToast = useUIStore((s) => s.showToast);
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const { profile, displayName, setDisplayName, save, isSaving, loadError, validationError, submitError, retryLoad } =
    useProfile();
  const shown = profile ?? user;
  const avatar = useAvatarUrl(Boolean(shown?.avatarPresent));
  const deleteAvatar = useDeleteAvatar();
  const uploadAvatar = useUploadAvatar();
  const invitations = useMyInvitations().data?.items ?? [];
  const [confirm, setConfirm] = React.useState<'logout' | 'avatar' | null>(null);

  const nameChanged = displayName.trim() !== (shown?.name ?? '');
  const workspaceName = activeWorkspace?.name ?? t('prof.ws.none');
  const isOwner = Boolean(activeWorkspace && shown && activeWorkspace.createdBy === shown.id);
  const themeOptions: ChipOption<ThemeMode>[] = [
    { value: 'light', label: t('prof.theme.light') },
    { value: 'dark', label: t('prof.theme.dark') },
    { value: 'system', label: t('prof.theme.system') },
  ];
  const languageOptions: ChipOption<Language>[] = [
    { value: 'VI', label: 'Tiếng Việt' },
    { value: 'EN', label: 'English' },
  ];
  const firstInvitation = invitations[0];

  const handleLogout = () => {
    setConfirm(null);
    void logoutAuthSession();
    router.replace('/(auth)/login');
  };

  const handlePickAvatar = async () => {
    let result: ImagePicker.ImagePickerResult;
    try {
      // The system photo picker needs no storage permission, so there is nothing to ask up front.
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
    } catch (error) {
      const denied = /permission/i.test(error instanceof Error ? error.message : '');
      showToast({
        type: 'error',
        title: t('prof.avatar.uploadFailed'),
        message: denied ? t('prof.avatar.noAccess') : friendlyErrorMessage(error),
      });
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const checked = checkAvatarImage(asset);
    if (checked.ok === false) {
      showToast({
        type: 'error',
        title: t('prof.avatar.uploadFailed'),
        message: t(checked.problem === 'size' ? 'prof.avatar.tooBig' : 'prof.avatar.badType'),
      });
      return;
    }
    try {
      await uploadAvatar.mutateAsync(checked.file);
      showToast({ type: 'success', title: t('prof.avatar.changed') });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      showToast({
        type: 'error',
        title: t('prof.avatar.uploadFailed'),
        message: status === 400 ? t('prof.avatar.rejected') : friendlyErrorMessage(error),
      });
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      await deleteAvatar.mutateAsync();
      showToast({ type: 'success', title: t('prof.avatar.deleted') });
    } catch (error) {
      showToast({ type: 'error', title: t('prof.avatar.deleteFailed'), message: friendlyErrorMessage(error) });
    } finally {
      setConfirm(null);
    }
  };

  const handleSave = async () => {
    await save();
  };

  const card = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('prof.title')}
        </Text>
        <HeaderActions />
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.safe}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[card, styles.profileCard]}>
            <View style={styles.identity}>
              <Pressable
                testID="profile-change-avatar"
                accessibilityRole="button"
                accessibilityLabel={t(shown?.avatarPresent ? 'prof.avatar.change' : 'prof.avatar.choose')}
                accessibilityState={{ busy: uploadAvatar.isPending, disabled: deleteAvatar.isPending }}
                disabled={uploadAvatar.isPending || deleteAvatar.isPending}
                onPress={() => void handlePickAvatar()}
                hitSlop={8}
                style={styles.avatarBox}
              >
                <Avatar name={shown?.name || shown?.email || '?'} size={64} uri={avatar.data} />
                <View style={[styles.camera, { backgroundColor: colors.button, borderColor: colors.card }]}>
                  <Camera size={15} strokeWidth={1.75} color={colors.onButton} />
                </View>
              </Pressable>
              <View style={styles.identityText}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                  {shown?.name || t('prof.noName')}
                </Text>
                <Text selectable style={[Typography.body, { color: colors.textMuted }]} numberOfLines={1}>
                  {shown?.email ?? '-'}
                </Text>
                {activeWorkspace ? (
                  <Text numberOfLines={1} style={[Typography.caption, { color: colors.textSubtle }]}>
                    {fill(t('prof.role.line'), { role: t(isOwner ? 'ws.role.owner' : 'ws.role.member'), workspace: workspaceName })}
                  </Text>
                ) : null}
              </View>
            </View>
            {shown?.avatarPresent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('prof.avatar.delete')}
                disabled={uploadAvatar.isPending || deleteAvatar.isPending}
                onPress={() => setConfirm('avatar')}
                style={styles.removeAvatar}
              >
                <Text style={[Typography.label, { color: colors.danger }]}>{t('prof.avatar.delete')}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text accessibilityRole="header" style={[styles.section, { color: colors.textSubtle }]}>
            {t('prof.info')}
          </Text>
          <View style={[card, styles.fields]}>
            {loadError ? (
              <View style={styles.inline}>
                <Text accessibilityRole="alert" style={[Typography.caption, styles.grow, { color: colors.danger }]}>
                  {t('prof.loadFailed')}
                </Text>
                <Button variant="secondary" label={t('ui.retry')} onPress={() => void retryLoad()} />
              </View>
            ) : null}
            <TextField
              testID="profile-display-name"
              label={t('prof.name.label')}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={120}
              autoCapitalize="words"
              editable={!isSaving}
              error={localizeValidation(validationError) ?? (submitError ? t('prof.saveFailed') : null)}
            />
            <TextField label={t('prof.email.label')} value={shown?.email ?? ''} editable={false} hint={t('prof.email.hint')} />
            <Button label={t('prof.save')} busy={isSaving} disabled={!nameChanged} onPress={() => void handleSave()} />
          </View>

          <Text accessibilityRole="header" style={[styles.section, { color: colors.textSubtle }]}>
            {t('prof.section.work')}
          </Text>
          <View style={card}>
            <NavRow
              testID="profile-workspace"
              tile={<StepTileText kind="action" label={initialsOf(workspaceName)} />}
              title={t('prof.ws.title')}
              subtitle={fill(t('prof.ws.line'), { name: workspaceName })}
              onPress={() => router.push('/(app)/workspace')}
            />
            <NavRow
              testID="profile-invitations"
              tile={<StepIcon kind="trigger" icon={Mail} />}
              title={t('prof.inv')}
              subtitle={
                firstInvitation
                  ? fill(t('prof.inv.sub'), { name: firstInvitation.invitedByName, workspace: firstInvitation.workspaceName })
                  : t('prof.inv.none')
              }
              badge={invitations.length}
              onPress={() => router.push('/(app)/invitations')}
            />
            <NavRow
              testID="profile-connections"
              tile={<StepIcon kind="logic" icon={PlugZap} />}
              title={t('prof.conn')}
              subtitle={t('prof.conn.sub')}
              onPress={() => router.push('/(app)/connections')}
            />
            <NavRow
              testID="profile-ai"
              tile={<StepTileText kind="ai" label="AI" />}
              title={t('prof.ai')}
              subtitle={t('prof.ai.sub')}
              onPress={() => router.push('/(app)/ai/generator')}
            />
            <NavRow
              testID="profile-assistant"
              tile={<StepIcon kind="ai" icon={MessageSquare} />}
              title={t('prof.assistant')}
              subtitle={t('prof.assistant.sub')}
              last
              onPress={() => router.push('/(app)/assistant')}
            />
          </View>

          <Text accessibilityRole="header" style={[styles.section, { color: colors.textSubtle }]}>
            {t('prof.section.look')}
          </Text>
          <View style={[card, styles.look]}>
            <View style={styles.lookGroup}>
              <Text style={[styles.lookLabel, { color: colors.text }]}>{t('prof.theme.label')}</Text>
              <SegmentedControl<ThemeMode>
                options={themeOptions}
                value={themeMode}
                onChange={setThemeMode}
                accessibilityLabel={t('prof.theme.label')}
              />
            </View>
            <View style={styles.lookGroup}>
              <Text style={[styles.lookLabel, { color: colors.text }]}>{t('prof.language.label')}</Text>
              <SegmentedControl<Language>
                options={languageOptions}
                value={language}
                onChange={setLanguage}
                accessibilityLabel={t('prof.language.label')}
              />
            </View>
          </View>

          <Text accessibilityRole="header" style={[styles.section, { color: colors.textSubtle }]}>
            {t('prof.section.security')}
          </Text>
          <View style={card}>
            <NavRow
              testID="profile-security"
              tile={<StepIcon kind="trigger" icon={Lock} />}
              title={t('prof.security')}
              subtitle={t('prof.security.sub')}
              last
              onPress={() => router.push('/(app)/settings')}
            />
          </View>

          <View style={styles.logout}>
            <Button
              testID="profile-logout"
              variant="danger"
              label={t('profile.logout')}
              icon={<LogOut size={16} strokeWidth={1.75} color={colors.danger} />}
              onPress={() => setConfirm('logout')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmSheet
        visible={confirm === 'logout'}
        title={t('prof.logout.title')}
        message={t('prof.logout.message')}
        confirmLabel={t('profile.logout')}
        destructive
        onConfirm={handleLogout}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'avatar'}
        title={t('prof.avatar.delete')}
        message={t('prof.avatar.deleteMessage')}
        confirmLabel={t('prof.avatar.delete')}
        destructive
        busy={deleteAvatar.isPending}
        onConfirm={() => void handleDeleteAvatar()}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const StepIcon: React.FC<{ kind: StepKind; icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }> }> = ({
  kind,
  icon: Icon,
}) => <StepTile kind={kind}>{(color) => <Icon size={18} strokeWidth={1.75} color={color} />}</StepTile>;

const NavRow: React.FC<{
  tile: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: number;
  last?: boolean;
  testID?: string;
  onPress: () => void;
}> = ({ tile, title, subtitle, badge = 0, last = false, testID, onPress }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, badge > 0 ? fill(t('prof.inv.count'), { count: badge }) : null, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.cardSecondary },
      ]}
    >
      {tile}
      <View style={styles.navText}>
        <Text style={[Typography.body, { color: colors.text, fontFamily: FontFamily.medium }]}>{title}</Text>
        <Text numberOfLines={2} style={[Typography.caption, { color: colors.textSubtle }]}>
          {subtitle}
        </Text>
      </View>
      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{badge}</Text>
        </View>
      ) : (
        <ChevronRight size={16} strokeWidth={1.75} color={colors.textSubtle} />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  title: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.four, gap: 14 },
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  profileCard: { padding: Spacing.three, gap: Spacing.two },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarBox: { width: 64, height: 64 },
  camera: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: FontFamily.semibold, fontSize: 18, lineHeight: 24 },
  removeAvatar: { minHeight: MinTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  section: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18, paddingTop: Spacing.one, paddingHorizontal: 2 },
  fields: { padding: Spacing.three, gap: Spacing.three },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingLeft: 14, paddingRight: 12 },
  navText: { flex: 1, minWidth: 0 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  look: { padding: 14, gap: 14 },
  lookGroup: { gap: Spacing.two },
  lookLabel: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  logout: { paddingTop: Spacing.one },
});
