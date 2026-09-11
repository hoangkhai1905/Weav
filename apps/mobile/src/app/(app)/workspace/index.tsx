import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Building2 } from 'lucide-react-native';
import { useWorkspace } from '../../../features/workspace/hooks/useWorkspace';
import { useThemeColors } from '../../../hooks/useThemeColors';

export default function WorkspaceScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { workspace, members } = useWorkspace();

  if (!workspace) return null;

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Workspace Details</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Workspace Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.wsHeader}>
            <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
              <Building2 color={colors.primary} size={22} />
            </View>
            <View style={styles.wsTitleGroup}>
              <Text style={[styles.wsName, { color: colors.text }]}>{workspace.name}</Text>
              <Text style={[styles.wsOwner, { color: colors.textSubtle }]}>Owner: {workspace.ownerName}</Text>
            </View>
          </View>
          <Text style={[styles.wsDesc, { color: colors.textMuted }]}>{workspace.description}</Text>

          <View style={[styles.webManageBox, { backgroundColor: colors.cardSecondary }]}>
            <Text style={[styles.webManageText, { color: colors.textMuted }]}>Full Workspace admin settings and team invitations are available on Web.</Text>
          </View>
        </View>

        {/* Team Members Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Workspace Members ({members.length})</Text>
        </View>

        <View style={styles.membersList}>
          {members.map((m) => (
            <View key={m.id} style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>{m.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.memberInfo}>
                <View style={styles.memberHeader}>
                  <Text style={[styles.memberName, { color: colors.text }]}>{m.name}</Text>
                  <View style={[styles.roleBadge, { backgroundColor: colors.cardSecondary }, m.role === 'OWNER' && { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder, borderWidth: 1 }]}>
                    <Text style={[styles.roleText, { color: colors.textSubtle }, m.role === 'OWNER' && { color: colors.primary }]}>{m.role}</Text>
                  </View>
                </View>
                <Text style={[styles.memberEmail, { color: colors.textSubtle }]}>{m.email}</Text>
                <Text style={[styles.memberPermission, { color: colors.primary }]}>
                  Publishing: {m.canPublishWorkflow ? '✓ Allowed' : '✕ Restricted'}
                </Text>
              </View>
            </View>
          ))}
        </View>
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
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  wsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  wsTitleGroup: { flex: 1 },
  wsName: { fontSize: 18, fontWeight: '900' },
  wsOwner: { fontSize: 12, marginTop: 2 },
  wsDesc: { fontSize: 13, lineHeight: 18 },
  webManageBox: { borderRadius: 12, padding: 12, marginTop: 4 },
  webManageText: { fontSize: 11, fontStyle: 'italic' },
  sectionHeader: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  membersList: { gap: 10 },
  memberCard: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  memberInfo: { flex: 1, gap: 2 },
  memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberName: { fontSize: 14, fontWeight: '700' },
  memberEmail: { fontSize: 11 },
  memberPermission: { fontSize: 10, marginTop: 2 },
  roleBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: '800' },
});
