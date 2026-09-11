import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Building2, Link2, Bot, Settings, LogOut, ChevronRight, Sparkles } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/auth.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { useTranslation } from '../../../hooks/useTranslation';
import { useThemeColors } from '../../../hooks/useThemeColors';

export default function ProfileScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { user, clearAuthSession } = useAuthStore();
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  const handleLogout = () => {
    clearAuthSession();
    router.replace('/(auth)/login');
  };

  const getInitials = (name?: string) => {
    if (!name) return 'US';
    return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Card */}
        <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user?.name || 'Nguyễn Anh Xuân Trường'}</Text>
            <Text style={[styles.userEmail, { color: colors.textMuted }]}>{user?.email || 'truong@example.com'}</Text>
          </View>
        </View>

        {/* Current Workspace */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('profile.current_ws')}</Text>
        </View>
        <Pressable
          style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/workspace')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
            <Building2 color={colors.primary} size={18} />
          </View>
          <View style={styles.menuTextGroup}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>{activeWorkspace.name}</Text>
            <Text style={[styles.menuSub, { color: colors.textSubtle }]}>
              {activeWorkspace.memberCount} Members • {activeWorkspace.ownerName}
            </Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        {/* App Tools */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('profile.app_tools')}</Text>
        </View>

        <Pressable
          style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/ai/generator')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
            <Sparkles color={colors.primary} size={18} />
          </View>
          <View style={styles.menuTextGroup}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>{t('profile.ai_gen')}</Text>
            <Text style={[styles.menuSub, { color: colors.textSubtle }]}>{t('profile.ai_gen_sub')}</Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        <Pressable
          style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/connections')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
            <Link2 color="#60a5fa" size={18} />
          </View>
          <View style={styles.menuTextGroup}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>{t('profile.conn')}</Text>
            <Text style={[styles.menuSub, { color: colors.textSubtle }]}>{t('profile.conn_sub')}</Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        <Pressable
          style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/telegram')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
            <Bot color="#38bdf8" size={18} />
          </View>
          <View style={styles.menuTextGroup}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>{t('profile.tg')}</Text>
            <Text style={[styles.menuSub, { color: colors.textSubtle }]}>{t('profile.tg_sub')}</Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        {/* Preferences */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('profile.prefs')}</Text>
        </View>

        <Pressable
          style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/settings')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
            <Settings color={colors.textMuted} size={18} />
          </View>
          <View style={styles.menuTextGroup}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>{t('profile.settings')}</Text>
            <Text style={[styles.menuSub, { color: colors.textSubtle }]}>{t('profile.settings_sub')}</Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        {/* Logout Button */}
        <Pressable style={[styles.logoutBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]} onPress={handleLogout}>
          <LogOut color={colors.danger} size={18} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>{t('profile.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 12 },
  userCard: { borderRadius: 20, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  avatarCircle: { width: 54, height: 54, borderRadius: 27, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 17, fontWeight: '800' },
  userEmail: { fontSize: 12 },
  sectionHeader: { marginTop: 8, marginBottom: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  menuItem: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  menuTextGroup: { flex: 1, gap: 2 },
  menuTitle: { fontSize: 14, fontWeight: '700' },
  menuSub: { fontSize: 11 },
  logoutBtn: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 },
  logoutText: { fontSize: 14, fontWeight: '700' },
});
