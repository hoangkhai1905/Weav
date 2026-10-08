import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, ChevronDown } from 'lucide-react-native';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { AiQuestion } from '../../../domain/ai/ai.types';
import type { ConnectionItem } from '../../../domain/connection/connection.types';
import { useConnections } from '../../connections/hooks/useConnections';
import { fill } from '../../common/fill';
import { deviceTimeZone, timeZoneChoices } from '../../common/timezone';
import { DEFAULT_SCHEDULE } from '../schedule';
import { controlFor, fieldName, humanizeField, providerForNodeType, questionKey } from '../ai.answers';
import { ScheduleField, scheduleValue } from './ScheduleField';

/** Values a question starts with (time zone = device, schedule = daily 08:00); the rest start empty. */
export function initialValues(questions: readonly AiQuestion[], t: (key: string) => string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const q of questions) {
    const control = controlFor(q);
    if (control === 'TIMEZONE') values[questionKey(q)] = deviceTimeZone();
    if (control === 'SCHEDULE') values[questionKey(q)] = scheduleValue(DEFAULT_SCHEDULE, t) ?? '';
  }
  return values;
}

interface QuestionsFormProps {
  questions: readonly AiQuestion[];
  values: Record<string, string>;
  /** Keys of the questions the last submit rejected (shows the inline "required" hint). */
  invalidKeys: readonly string[];
  urlErrorKeys: readonly string[];
  onChange: (key: string, value: string) => void;
}

export const QuestionsForm: React.FC<QuestionsFormProps> = ({ questions, values, invalidKeys, urlErrorKeys, onChange }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={styles.list}>
      {questions.map((q) => {
        const key = questionKey(q);
        const control = controlFor(q);
        const invalid = invalidKeys.includes(key);
        const urlError = urlErrorKeys.includes(key);
        const label = questionLabel(q, t);
        return (
          <View
            key={key}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: invalid || urlError ? colors.danger : colors.border },
            ]}
          >
            <Text style={[Typography.label, { color: colors.text }]}>{label}</Text>
            {q.code === 'VALUE' || q.code === 'URL' ? (
              <Text style={[Typography.caption, { color: colors.textMuted }]}>
                {fill(t('aig.q.step'), { step: stepLabel(q.field, t) })}
              </Text>
            ) : null}
            {control === 'SCHEDULE' ? (
              <ScheduleField onChange={(v) => onChange(key, v ?? '')} />
            ) : control === 'TIMEZONE' ? (
              <TimeZoneField value={values[key] ?? deviceTimeZone()} onChange={(v) => onChange(key, v)} />
            ) : control === 'CONNECTION' ? (
              <ConnectionField nodeType={q.field} value={values[key] ?? ''} onChange={(v) => onChange(key, v)} />
            ) : (
              <TextInput
                accessibilityLabel={label}
                value={values[key] ?? ''}
                onChangeText={(v) => onChange(key, v)}
                placeholder={control === 'URL' ? 'https://' : label}
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={control === 'URL' ? 'url' : 'default'}
                multiline={control === 'TEXT' && fieldName(q.field) === 'body'}
                maxLength={4000}
                style={[
                  styles.input,
                  { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong, color: colors.text, outlineColor: colors.primary },
                ]}
              />
            )}
            {control === 'URL' ? (
              <Text style={[Typography.caption, { color: urlError ? colors.danger : colors.textMuted }]}>
                {urlError ? t('aig.q.URL.invalid') : t('aig.q.URL.hint')}
              </Text>
            ) : null}
            {invalid ? (
              <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>
                {t('aig.required')}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

/** "email.send.subject" -> "Tiêu đề email"; unknown fields are humanized, never shown as raw codes. */
function questionLabel(q: AiQuestion, t: (key: string) => string): string {
  if (q.code === 'URL') return t('aig.q.URL');
  if (q.code === 'SCHEDULE') return t('aig.q.SCHEDULE');
  if (q.code === 'TIMEZONE') return t('aig.q.TIMEZONE');
  if (q.code === 'CONNECTION') {
    const provider = providerForNodeType(q.field);
    return provider ? fill(t('aig.q.CONNECTION'), { provider: t(`provider.${provider}`) }) : t('aig.q.CONNECTION.generic');
  }
  const name = fieldName(q.field);
  const known = t(`aig.field.${name}`);
  return known !== `aig.field.${name}` ? known : fill(t('aig.q.VALUE.generic'), { field: humanizeField(name) });
}

/** The node the question is about, as a friendly step name ("email.send.body" -> "Gửi email"). */
function stepLabel(field: string, t: (key: string) => string): string {
  const parts = field.split('.');
  for (let n = parts.length - 1; n >= 1; n -= 1) {
    const type = parts.slice(0, n).join('.');
    const label = t(`node.type.${type}`);
    if (label !== `node.type.${type}`) return label;
  }
  return humanizeField(parts[0] ?? field);
}

const TimeZoneField: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => timeZoneChoices(), []);
  const device = deviceTimeZone();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('aig.tz.change')}. ${fill(t('aig.tz.current'), { zone: value })}`}
        onPress={() => setOpen(true)}
        style={[styles.picker, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}
      >
        <Text style={[Typography.body, styles.pickerText, { color: colors.text }]}>
          {value}
          {value === device ? ` (${t('aig.tz.device')})` : ''}
        </Text>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('aig.tz.pick')}>
        {choices.map((zone) => (
          <Choice
            key={zone}
            label={zone === device ? `${zone} (${t('aig.tz.device')})` : zone}
            selected={zone === value}
            onPress={() => {
              onChange(zone);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
};

const ConnectionField: React.FC<{ nodeType: string; value: string; onChange: (id: string) => void }> = ({
  nodeType,
  value,
  onChange,
}) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const query = useConnections();
  const provider = providerForNodeType(nodeType);
  const usable: ConnectionItem[] = (query.data ?? []).filter(
    (c) => c.status === 'ACTIVE' && c.canAttach && (!provider || c.provider === provider),
  );

  if (query.isPending) return <Skeleton height={MinTouch} radius={Radius.md} />;
  if (usable.length === 0) {
    return (
      <View style={styles.list}>
        <Text style={[Typography.body, { color: colors.textMuted }]}>{t('aig.q.CONNECTION.none')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('aig.q.CONNECTION.manage')}
          onPress={() => router.push('/(app)/connections')}
          style={styles.link}
        >
          <Text style={[Typography.label, { color: colors.primary }]}>{t('aig.q.CONNECTION.manage')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {usable.map((c) => (
        <Choice key={c.id} label={c.name} sub={t(`provider.${c.provider}`)} selected={c.id === value} onPress={() => onChange(c.id)} />
      ))}
    </View>
  );
};

const Choice: React.FC<{ label: string; sub?: string; selected: boolean; onPress: () => void }> = ({
  label,
  sub,
  selected,
  onPress,
}) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? colors.primaryBg : colors.card,
          borderColor: selected ? colors.primaryBorder : colors.border,
        },
      ]}
    >
      <View style={styles.pickerText}>
        <Text style={[Typography.body, { color: colors.text, fontWeight: selected ? '700' : '400' }]}>{label}</Text>
        {sub ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{sub}</Text> : null}
      </View>
      {selected ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  input: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  pickerText: { flex: 1 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  link: { minHeight: MinTouch, justifyContent: 'center' },
});
