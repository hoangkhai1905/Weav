import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Calendar,
  CircleCheck,
  Globe,
  HardDrive,
  Mail,
  PlugZap,
  Send,
  Sheet,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import type { ConnectionItem, ConnectionProvider, ConnectionTestOutcome } from '../../../domain/connection/connection.types';
import { Button } from '../../../components/ui/Button';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import { formatRelativeTime } from '../../common/time';
import { credentialExpiry } from '../connection.expiry';

const ICONS: Record<ConnectionProvider, LucideIcon> = {
  GMAIL: Mail,
  GOOGLE_SHEETS: Sheet,
  GOOGLE_CALENDAR: Calendar,
  GOOGLE_DRIVE: HardDrive,
  TELEGRAM: Send,
  HTTP: Globe,
};

/** Result of the last "Test" press: a verdict from the backend or a request failure message. */
export type TestResult = { outcome: ConnectionTestOutcome } | { error: string };

interface ConnectionCardProps {
  item: ConnectionItem;
  testing: boolean;
  result?: TestResult;
  onTest: () => void;
  onDisable: () => void;
}

const OUTCOME_KEY: Record<ConnectionTestOutcome, string> = {
  VERIFIED: 'conn.test.VERIFIED',
  AUTH_INVALID: 'conn.test.AUTH_INVALID',
  DEPENDENCY_FAILURE: 'conn.test.DEPENDENCY_FAILURE',
};

export const ConnectionCard: React.FC<ConnectionCardProps> = ({ item, testing, result, onTest, onDisable }) => {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const Icon = ICONS[item.provider] ?? PlugZap;
  const expiry = credentialExpiry(item.credentialExpiresAt);
  const daysLeft = item.credentialExpiresAt
    ? Math.max(1, Math.ceil((new Date(item.credentialExpiresAt).getTime() - Date.now()) / 86_400_000))
    : 0;
  const warnTone = expiry === 'expired' ? colors.tones.danger : colors.tones.warning;
  const verified = !!result && 'outcome' in result && result.outcome === 'VERIFIED';
  const resultTone = !result
    ? null
    : verified
      ? colors.tones.success
      : 'error' in result
        ? colors.tones.danger
        : colors.tones.warning;
  const resultText = !result ? '' : 'error' in result ? result.error : t(OUTCOME_KEY[result.outcome]);

  return (
    <View testID={`connection-${item.id}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: colors.cardSecondary }]}>
          <Icon size={20} color={colors.primary} />
        </View>
        <View style={styles.main}>
          <Text style={[Typography.body, styles.name, { color: colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{t(`provider.${item.provider}`)}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.facts}>
        <Text style={[Typography.caption, { color: colors.textMuted }]}>
          {t(item.hasCredential ? 'conn.hasCredential' : 'conn.noCredential')}
        </Text>
        <Text style={[Typography.caption, { color: colors.textMuted }]}>
          {t('conn.lastVerified')}:{' '}
          {item.lastVerifiedAt ? formatRelativeTime(item.lastVerifiedAt, language) : t('conn.neverVerified')}
        </Text>
      </View>

      {expiry === 'soon' || expiry === 'expired' ? (
        <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: warnTone.bg, borderColor: warnTone.border }]}>
          <TriangleAlert size={14} color={warnTone.fg} />
          <Text style={[Typography.caption, styles.noticeText, { color: warnTone.fg }]}>
            {expiry === 'expired' ? t('conn.expired') : t('conn.expiresSoon').replace('{n}', String(daysLeft))}
          </Text>
        </View>
      ) : null}

      {item.status === 'INVALID' ? (
        <Text style={[Typography.caption, { color: colors.tones.warning.fg }]}>{t('conn.invalidHelp')}</Text>
      ) : null}

      {resultTone ? (
        <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: resultTone.bg, borderColor: resultTone.border }]}>
          {verified ? <CircleCheck size={14} color={resultTone.fg} /> : <TriangleAlert size={14} color={resultTone.fg} />}
          <Text style={[Typography.caption, styles.noticeText, { color: resultTone.fg }]}>{resultText}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {/* A new connection starts DISABLED and a passing test activates it, so Test is always offered. */}
        <View style={styles.action}>
          <Button variant="secondary" label={t('conn.test')} busy={testing} onPress={onTest} />
        </View>
        {item.canManage && item.status !== 'DISABLED' ? (
          <View style={styles.action}>
            <Button variant="danger" label={t('conn.disable')} disabled={testing} onPress={onDisable} />
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: Spacing.half },
  name: { fontWeight: '600' },
  facts: { gap: Spacing.half },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderWidth: 1, borderRadius: Radius.sm },
  noticeText: { flex: 1, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
