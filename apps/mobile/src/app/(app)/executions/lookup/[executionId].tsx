import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { executionRepository } from '../../../../infrastructure/repository-factory';
import { useActiveWorkspaceId } from '../../../../features/workspace/active-workspace';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { useTranslation } from '../../../../hooks/useTranslation';

/**
 * Entry point for EXECUTION notifications, which carry no workflowId. Resolves it with the
 * repository's single lookup function, then replaces itself with the real detail route.
 */
export default function ExecutionLookupScreen() {
  const { executionId } = useLocalSearchParams<{ executionId: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const workspaceId = useActiveWorkspaceId();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!workspaceId || !executionId) return;
    let cancelled = false;
    executionRepository
      .findWorkflowIdForExecution(workspaceId, executionId)
      .then((workflowId) => {
        if (cancelled) return;
        if (workflowId) router.replace(`/(app)/executions/${workflowId}/${executionId}`);
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, executionId, router]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.center}>
        {notFound ? (
          <>
            <Text style={[styles.text, { color: colors.textMuted }]}>{t('execution.lookup_not_found')}</Text>
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/executions'))}>
              <Text style={[styles.link, { color: colors.primary }]}>{t('common.back')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.text, { color: colors.textMuted }]}>{t('execution.lookup_loading')}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  text: { fontSize: 13, textAlign: 'center' },
  link: { fontSize: 14, fontWeight: '600' },
});
