import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import { fill } from '../../common/fill';
import {
  DEFAULT_SCHEDULE,
  WEEKDAY_CODES,
  buildScheduleAnswer,
  pad2,
  type ScheduleChoice,
  type ScheduleFrequency,
  type WeekdayCode,
} from '../schedule';

const FREQUENCIES: ScheduleFrequency[] = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];

/** Plain-language sentence for a choice, in the UI language ("Mỗi ngày lúc 08:00"). */
export function scheduleSentence(choice: ScheduleChoice, t: (key: string) => string): string {
  const time = `${pad2(choice.hour)}:${pad2(choice.minute)}`;
  return fill(t(`aig.sched.sentence.${choice.frequency}`), {
    minute: choice.minute,
    time,
    day: choice.monthDay,
    weekday: t(`aig.sched.weekday.${choice.weekday}`).toLowerCase(),
  });
}

/** The value stored for a SCHEDULE question (sentence + exact cron), or null when invalid. */
export function scheduleValue(choice: ScheduleChoice, t: (key: string) => string): string | null {
  return buildScheduleAnswer(choice, scheduleSentence(choice, t));
}

interface ScheduleFieldProps {
  onChange: (value: string | null) => void;
}

/** Frequency / time pickers (no cron typing). Emits the backend answer text on every change. */
export const ScheduleField: React.FC<ScheduleFieldProps> = ({ onChange }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ScheduleChoice>(DEFAULT_SCHEDULE);

  useEffect(() => {
    onChange(scheduleValue(choice, t));
    // t changes identity every render; the choice and the language decide the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, t('aig.sched.freq.DAILY')]);

  const patch = (next: Partial<ScheduleChoice>) => setChoice((c) => ({ ...c, ...next }));
  const freqChips: ChipOption<ScheduleFrequency>[] = FREQUENCIES.map((value) => ({
    value,
    label: t(`aig.sched.freq.${value}`),
  }));
  const weekdayChips: ChipOption<WeekdayCode>[] = WEEKDAY_CODES.map((value) => ({
    value,
    label: t(`aig.sched.weekday.${value}`),
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        <FilterChips<ScheduleFrequency>
          options={freqChips}
          value={choice.frequency}
          onChange={(frequency) => patch({ frequency })}
          accessibilityLabel={t('aig.sched.freq.label')}
        />
      </View>
      {choice.frequency === 'WEEKLY' ? (
        <>
          <Text style={[Typography.label, { color: colors.textMuted }]}>{t('aig.sched.weekday')}</Text>
          <View style={styles.chips}>
            <FilterChips<WeekdayCode>
              options={weekdayChips}
              value={choice.weekday}
              onChange={(weekday) => patch({ weekday })}
              accessibilityLabel={t('aig.sched.weekday')}
            />
          </View>
        </>
      ) : null}
      {choice.frequency === 'MONTHLY' ? (
        <View style={styles.row}>
          <Stepper
            label={t('aig.sched.monthDay')}
            value={choice.monthDay}
            min={1}
            max={28}
            step={1}
            onChange={(monthDay) => patch({ monthDay })}
          />
          <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{t('aig.sched.monthDay.note')}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        {choice.frequency !== 'HOURLY' ? (
          <Stepper
            label={t('aig.sched.hour')}
            value={choice.hour}
            min={0}
            max={23}
            step={1}
            wrap
            onChange={(hour) => patch({ hour })}
          />
        ) : null}
        <Stepper
          label={t('aig.sched.minute')}
          value={choice.minute}
          min={0}
          max={59}
          step={5}
          wrap
          onChange={(minute) => patch({ minute })}
        />
      </View>
      <View style={[styles.preview, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}>
        <Text style={[Typography.label, { color: colors.text }]}>
          {fill(t('aig.sched.preview'), { text: scheduleSentence(choice, t) })}
        </Text>
      </View>
    </View>
  );
};

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Going past the end wraps to the other end (hours 23 -> 0). */
  wrap?: boolean;
  onChange: (value: number) => void;
}

const Stepper: React.FC<StepperProps> = ({ label, value, min, max, step, wrap = false, onChange }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const lastOnGrid = min + Math.floor((max - min) / step) * step;
  const move = (dir: 1 | -1) => {
    const next = value + dir * step;
    if (next > lastOnGrid) onChange(wrap ? min : lastOnGrid);
    else if (next < min) onChange(wrap ? lastOnGrid : min);
    else onChange(next);
  };
  const btn = [styles.stepBtn, { backgroundColor: colors.card, borderColor: colors.borderStrong }];
  return (
    <View style={styles.stepper} accessible={false}>
      <Text style={[Typography.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fill(t('aig.decrease'), { label })}
          onPress={() => move(-1)}
          style={btn}
        >
          <Minus size={18} color={colors.text} />
        </Pressable>
        <Text
          accessibilityLabel={`${label}: ${value}`}
          style={[Typography.title, styles.stepValue, { color: colors.text }]}
        >
          {pad2(value)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fill(t('aig.increase'), { label })}
          onPress={() => move(1)}
          style={btn}
        >
          <Plus size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  // FilterChips pads its row by Spacing.three; the form card already pads, so pull the row back out.
  chips: { marginHorizontal: -Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: Spacing.four },
  note: { flexBasis: '100%' },
  stepper: { gap: Spacing.one },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepBtn: {
    width: MinTouch,
    height: MinTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  stepValue: { minWidth: 40, textAlign: 'center' },
  preview: { padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
});
