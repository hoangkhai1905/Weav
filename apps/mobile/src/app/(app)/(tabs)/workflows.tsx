import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { TeamWorkflowsPane } from '../../../features/workflows/components/TeamWorkflowsPane';
import { TemplatesPane } from '../../../features/templates/components/TemplatesPane';
import { HeaderActions } from '../../../components/ui/HeaderActions';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, MinTouch, Radius, Spacing } from '../../../constants/theme';

type Segment = 'team' | 'templates';

export default function WorkflowsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<Segment>('team');

  // Home's "Dùng mẫu có sẵn" opens this tab on the templates list; the tab stays mounted, so read the
  // parameter whenever it arrives and clear it so the same shortcut works again later.
  useEffect(() => {
    if (params.segment === 'templates') {
      setSegment('templates');
      router.setParams({ segment: undefined });
    }
  }, [params.segment, router]);

  const openAi = () => router.push('/(app)/ai/generator');

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('wfl.title')}
        </Text>
        <HeaderActions />
        <Pressable
          testID="workflows-create"
          accessibilityRole="button"
          accessibilityLabel={t('wfl.create.ai')}
          onPress={openAi}
          style={[styles.create, { backgroundColor: colors.button }]}
        >
          <Plus size={20} strokeWidth={1.75} color={colors.onButton} />
        </Pressable>
      </View>
      <View style={styles.segment}>
        <SegmentedControl<Segment>
          accessibilityLabel={t('wfl.seg.label')}
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'team', label: t('wfl.seg.team') },
            { value: 'templates', label: t('wfl.seg.templates') },
          ]}
        />
      </View>
      {segment === 'team' ? <TeamWorkflowsPane onCreate={openAi} /> : <TemplatesPane />}
    </SafeAreaView>
  );
}

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
  create: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  segment: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
});
