import React from 'react';
import { useRouter } from 'expo-router';
import { Building2 } from 'lucide-react-native';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

/** Shown instead of a workspace-scoped list when the user has no workspace yet (its query never runs). */
export const NoWorkspaceState: React.FC = () => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Building2 size={36} color={colors.textMuted} />}
      title={t('dash.noWorkspace.title')}
      description={t('dash.noWorkspace.body')}
      actionLabel={t('dash.noWorkspace.action')}
      onAction={() => router.push('/(app)/workspace')}
    />
  );
};
