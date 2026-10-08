import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Building2, ChevronRight, LogOut, MessageSquare, PlugZap, ShieldCheck, Sparkles } from 'lucide-react-native';
import { useProfile } from '../../../features/profile/hooks/useProfile';
import { useAvatarUrl, useDeleteAvatar, useUploadAvatar } from '../../../features/profile/hooks/useAccount';
import { logoutAuthSession } from '../../../features/auth/auth-session.runtime';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { checkAvatarImage } from '../../../features/profile/avatar.utils';
import { localizeValidation } from '../../../features/common/validation-copy';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListItem } from '../../../components/ui/ListItem';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { TextField } from '../../../components/ui/TextField';
import { Radius, Spacing, Typography } from '../../../constants/theme';
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
  const [confirm, setConfirm] = React.useState<'logout' | 'avatar' | null>(null);

  const nameChanged = displayName.trim() !== (shown?.name ?? '');
  const themeOptions: ChipOption<ThemeMode>[] = [
    { value: 'light', label: t('prof.theme.light') },
    { value: 'dark', label: t('prof.theme.dark') },
    { value: 'system', label: t('prof.theme.system') },
  ];
  const languageOptions: ChipOption<Language>[] = [
    { value: 'VI', label: 'Tiếng Việt' },
    { value: 'EN', label: 'English' },
  ];

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('tab.profile')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.identity}>
            <Avatar name={shown?.name || shown?.email || '?'} size={64} uri={avatar.data} />
            <View style={styles.identityText}>
              <Text style={[Typography.title, { color: colors.text }]} numberOfLines={2}>
                {shown?.name || t('prof.noName')}
              </Text>
              <Text selectable style={[Typography.caption, { color: colors.textMuted }]} numberOfLines={1}>
                {shown?.email ?? '-'}
              </Text>
            </View>
          </View>
          <Button
            variant="secondary"
            label={t(shown?.avatarPresent ? 'prof.avatar.change' : 'prof.avatar.choose')}
            busy={uploadAvatar.isPending}
            disabled={deleteAvatar.isPending}
            onPress={() => void handlePickAvatar()}
          />
          {shown?.avatarPresent ? (
            <Button
              variant="secondary"
              label={t('prof.avatar.delete')}
              busy={deleteAvatar.isPending}
              disabled={uploadAvatar.isPending}
              onPress={() => setConfirm('avatar')}
            />
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
            {t('prof.info')}
          </Text>
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
          <Button
            label={t('prof.save')}
            busy={isSaving}
            disabled={!nameChanged}
            onPress={() => void handleSave()}
          />
        </View>

        <Text style={[Typography.label, { color: colors.textMuted }]}>{t('prof.section.work')}</Text>
        <View style={styles.group}>
          <ListItem
            leading={<Building2 size={20} color={colors.primary} />}
            title={activeWorkspace?.name ?? t('prof.ws.none')}
            subtitle={t('prof.ws.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/workspace')}
          />
          <ListItem
            leading={<PlugZap size={20} color={colors.primary} />}
            title={t('prof.conn')}
            subtitle={t('prof.conn.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/connections')}
          />
          <ListItem
            leading={<Sparkles size={20} color={colors.primary} />}
            title={t('prof.ai')}
            subtitle={t('prof.ai.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/ai/generator')}
          />
          <ListItem
            leading={<MessageSquare size={20} color={colors.primary} />}
            title={t('prof.assistant')}
            subtitle={t('prof.assistant.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/assistant')}
          />
        </View>

        <Text style={[Typography.label, { color: colors.textMuted }]}>{t('prof.section.look')}</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[Typography.label, { color: colors.text }]}>{t('prof.theme.label')}</Text>
          <FilterChips options={themeOptions} value={themeMode} onChange={setThemeMode} accessibilityLabel={t('prof.theme.label')} />
          <Text style={[Typography.label, { color: colors.text }]}>{t('prof.language.label')}</Text>
          <FilterChips options={languageOptions} value={language} onChange={setLanguage} accessibilityLabel={t('prof.language.label')} />
        </View>

        <Text style={[Typography.label, { color: colors.textMuted }]}>{t('prof.section.security')}</Text>
        <ListItem
          leading={<ShieldCheck size={20} color={colors.primary} />}
          title={t('prof.security')}
          subtitle={t('prof.security.sub')}
          trailing={<ChevronRight size={18} color={colors.textSubtle} />}
          onPress={() => router.push('/(app)/settings')}
        />

        <Button
          variant="danger"
          label={t('profile.logout')}
          icon={<LogOut size={16} color={colors.danger} />}
          onPress={() => setConfirm('logout')}
        />
        {deleteAvatar.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      </ScrollView>

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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.five },
  card: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  identityText: { flex: 1, gap: Spacing.half },
  group: { gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
