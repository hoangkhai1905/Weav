import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Moon, Sun, Bell, Shield, Info, LogOut, Globe } from 'lucide-react-native';
import { useUIStore } from '../../../stores/ui.store';
import { useAuthStore } from '../../../stores/auth.store';
import { useTranslation } from '../../../hooks/useTranslation';
import { useThemeColors } from '../../../hooks/useThemeColors';

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { toggleTheme, showToast } = useUIStore();
  const { language, toggleLanguage, t } = useTranslation();
  const clearAuthSession = useAuthStore((s) => s.clearAuthSession);

  const [pushNotifs, setPushNotifs] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);

  const handleLogout = () => {
    clearAuthSession();
    router.replace('/(auth)/login');
  };

  const handleToggleLang = () => {
    toggleLanguage();
    showToast({
      type: 'success',
      title: language === 'VI' ? 'Switched to English 🇬🇧' : 'Đã chuyển sang Tiếng Việt 🇻🇳',
      message: language === 'VI' ? 'System language updated to English' : 'Đã cập nhật ngôn ngữ hệ thống sang Tiếng Việt',
    });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Appearance & Language Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.appearance')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Dark Mode Switch */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              {colors.isDark ? <Moon color={colors.primary} size={18} /> : <Sun color="#f59e0b" size={18} />}
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.dark_mode')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                  {colors.isDark ? 'Dark Mode' : 'Light Mode'}
                </Text>
              </View>
            </View>
            <Switch
              value={colors.isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>

          {/* Language Switcher */}
          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
            <View style={styles.rowLeft}>
              <Globe color={colors.primary} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.language')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                  {language === 'VI' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
                </Text>
              </View>
            </View>
            <Pressable style={[styles.langBtn, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]} onPress={handleToggleLang}>
              <Text style={[styles.langBtnText, { color: colors.primary }]}>
                {language === 'VI' ? '🇻🇳 VI' : '🇬🇧 EN'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Notifications Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.notifications')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Bell color="#38bdf8" size={18} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.push_alerts')}</Text>
            </View>
            <Switch
              value={pushNotifs}
              onValueChange={(val) => {
                setPushNotifs(val);
                showToast({ type: 'info', title: 'Notification Settings', message: `Push alerts ${val ? 'enabled' : 'disabled'}` });
              }}
              trackColor={{ false: colors.borderStrong, true: '#0ea5e9' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
            <View style={styles.rowLeft}>
              <Bell color={colors.primary} size={18} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.email_summaries')}</Text>
            </View>
            <Switch
              value={emailNotifs}
              onValueChange={setEmailNotifs}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* Security Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.security')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Shield color={colors.success} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.session_verified')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>{t('settings.session_status')}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* About App */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.about')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Info color={colors.textMuted} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.system_ver')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>React Native 0.86 • Expo 57 • Bilingual i18n</Text>
              </View>
            </View>
          </View>
        </View>

        <Pressable style={[styles.logoutBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]} onPress={handleLogout}>
          <LogOut color={colors.danger} size={18} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>{t('settings.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  sectionHeader: { marginTop: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 11, marginTop: 2 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  langBtnText: { fontSize: 12, fontWeight: '800' },
  logoutBtn: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 },
  logoutText: { fontSize: 14, fontWeight: '700' },
});
