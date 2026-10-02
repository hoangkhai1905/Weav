import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bot, Send } from 'lucide-react-native';
import { useTelegram } from '../../../features/telegram/hooks/useTelegram';
import { useUIStore } from '../../../stores/ui.store';
import { useThemeColors } from '../../../hooks/useThemeColors';

export default function TelegramScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { telegramStatus, isLoading, createLinkCode, isGeneratingCode } = useTelegram();
  const showToast = useUIStore((s) => s.showToast);

  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null);

  if (isLoading || !telegramStatus) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      </SafeAreaView>
    );
  }

  const handleGenerateCode = async () => {
    try {
      const res = await createLinkCode();
      setGeneratedCode(res);
      showToast({ type: 'success', title: 'Linking Code Generated 🤖', message: `Code: ${res.code}` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Error', message: e.message });
    }
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Telegram Bot Status</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statusRow}>
            <View style={styles.iconCircle}>
              <Bot color="#38bdf8" size={24} />
            </View>
            <View style={styles.statusInfo}>
              <Text style={[styles.botName, { color: colors.text }]}>{telegramStatus.botUsername}</Text>
              <Text style={[styles.accountText, { color: colors.textSubtle }]}>
                {telegramStatus.connected ? `Linked: ${telegramStatus.linkedAccount}` : 'Not Linked'}
              </Text>
            </View>
            <View style={[styles.badge, telegramStatus.connected ? styles.badgeConnected : styles.badgeDisconnected]}>
              <Text style={[styles.badgeText, telegramStatus.connected ? styles.textConnected : styles.textDisconnected]}>
                {telegramStatus.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </Text>
            </View>
          </View>
        </View>

        {/* Linking Generator Box */}
        <View style={[styles.linkSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Link Mobile Device to Telegram</Text>
          <Text style={[styles.sectionSub, { color: colors.textMuted }]}>Generate a 6-digit linking passcode and send it to @weav_automation_bot in Telegram.</Text>

          {generatedCode ? (
            <View style={[styles.codeBox, { backgroundColor: colors.cardSecondary }]}>
              <Text style={[styles.codeLabel, { color: colors.textMuted }]}>Your 6-Digit Link Code:</Text>
              <Text style={styles.codeDisplay}>{generatedCode.code}</Text>
              <Text style={[styles.codeExpiry, { color: colors.textSubtle }]}>Expires at: {generatedCode.expiresAt}</Text>
            </View>
          ) : null}

          <Pressable style={styles.codeBtn} onPress={handleGenerateCode} disabled={isGeneratingCode}>
            <Send color="#ffffff" size={16} />
            <Text style={styles.codeBtnText}>
              {isGeneratingCode ? 'Generating Code...' : 'Generate New Link Code'}
            </Text>
          </Pressable>
        </View>

        {/* Bot Capabilities Info */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Available Telegram Commands</Text>
        </View>

        <View style={[styles.cmdCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cmdRow}>
            <Text style={styles.cmdCode}>/list</Text>
            <Text style={[styles.cmdDesc, { color: colors.textMuted }]}>List all published workflows in workspace</Text>
          </View>
          <View style={styles.cmdRow}>
            <Text style={styles.cmdCode}>/status [execId]</Text>
            <Text style={[styles.cmdDesc, { color: colors.textMuted }]}>Inspect real-time execution step progress</Text>
          </View>
          <View style={styles.cmdRow}>
            <Text style={styles.cmdCode}>/run [wfId]</Text>
            <Text style={[styles.cmdDesc, { color: colors.textMuted }]}>Trigger manual workflow run via Telegram</Text>
          </View>
        </View>

        {/* Activity Logs Stream */}
        {telegramStatus.activityLogs && telegramStatus.activityLogs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Bot Activity</Text>
            </View>

            <View style={[styles.logsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {telegramStatus.activityLogs.map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Text style={[styles.logTime, { color: colors.textSubtle }]}>{log.timestamp}</Text>
                  <Text style={[styles.logDirection, log.direction === 'OUTGOING' ? styles.dirOut : styles.dirIn]}>
                    {log.direction}
                  </Text>
                  <Text style={[styles.logMsg, { color: colors.textMuted }]} numberOfLines={1}>{log.message}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(56, 189, 248, 0.15)', justifyContent: 'center', alignItems: 'center' },
  statusInfo: { flex: 1 },
  botName: { fontSize: 16, fontWeight: '800' },
  accountText: { fontSize: 11, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeConnected: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  badgeDisconnected: { backgroundColor: 'rgba(244, 63, 94, 0.15)', borderColor: 'rgba(244, 63, 94, 0.3)' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  textConnected: { color: '#34d399' },
  textDisconnected: { color: '#fb7185' },
  linkSection: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10 },
  sectionHeader: { marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionSub: { fontSize: 12, lineHeight: 16 },
  codeBox: { borderRadius: 14, borderWidth: 1, borderColor: '#38bdf8', padding: 14, alignItems: 'center', gap: 4 },
  codeLabel: { fontSize: 11 },
  codeDisplay: { color: '#38bdf8', fontSize: 28, fontWeight: '900', letterSpacing: 4 },
  codeExpiry: { fontSize: 10 },
  codeBtn: { backgroundColor: '#0ea5e9', borderRadius: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  codeBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  cmdCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  cmdRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cmdCode: { color: '#38bdf8', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', minWidth: 100 },
  cmdDesc: { fontSize: 11, flex: 1 },
  logsCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 8 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logTime: { fontSize: 10, fontFamily: 'monospace' },
  logDirection: { fontSize: 9, fontWeight: '800', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dirIn: { color: '#34d399', backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  dirOut: { color: '#60a5fa', backgroundColor: 'rgba(96, 165, 250, 0.15)' },
  logMsg: { fontSize: 11, flex: 1 },
});
