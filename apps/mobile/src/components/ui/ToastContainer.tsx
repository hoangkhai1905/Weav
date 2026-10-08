import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react-native';
import { useUIStore } from '../../stores/ui.store';
import { useThemeColors } from '../../hooks/useThemeColors';

export const ToastContainer: React.FC = () => {
  const colors = useThemeColors();
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast) => {
        let accentColor = colors.primary;
        let IconComponent = Info;

        if (toast.type === 'success') {
          accentColor = colors.success;
          IconComponent = CheckCircle2;
        } else if (toast.type === 'error') {
          accentColor = colors.danger;
          IconComponent = AlertCircle;
        } else if (toast.type === 'warning') {
          accentColor = colors.warning;
          IconComponent = AlertTriangle;
        }

        return (
          <Pressable
            key={toast.id}
            onPress={() => removeToast(toast.id)}
            style={[
              styles.toast,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderLeftColor: accentColor,
              },
            ]}
          >
            <View style={styles.leftRow}>
              <IconComponent color={accentColor} size={20} />
              <View style={styles.content}>
                <Text style={[styles.title, { color: colors.text }]}>{toast.title}</Text>
                {toast.message && <Text style={[styles.message, { color: colors.textMuted }]}>{toast.message}</Text>}
              </View>
            </View>
            <X color={colors.textSubtle} size={16} />
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
});
