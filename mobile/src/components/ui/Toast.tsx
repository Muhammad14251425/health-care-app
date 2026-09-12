/**
 * Toasts.
 *
 * Native-feeling snackbars for confirmations ("Payment recorded"), not
 * browser-style alerts. Alert.alert is reserved for genuine confirmations where
 * the user must choose.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, Info } from 'lucide-react-native';
import { colors, radius, shadows, spacing } from '@/theme';
import { Text } from './Text';

type ToastKind = 'success' | 'error' | 'info';

type ToastMessage = { id: number; text: string; kind: ToastKind };

type ToastApi = {
  show: (text: string, kind?: ToastKind) => void;
  success: (text: string) => void;
  error: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const VISIBLE_MS = 2800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(20)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  const insets = useSafeAreaInsets();

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 20, duration: 180, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translate]);

  const show = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      nextId.current += 1;
      setToast({ id: nextId.current, text, kind });

      opacity.setValue(0);
      translate.setValue(20);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(translate, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 4,
        }),
      ]).start();

      timer.current = setTimeout(hide, VISIBLE_MS);
    },
    [hide, opacity, translate],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text: string) => show(text, 'success'),
      error: (text: string) => show(text, 'error'),
    }),
    [show],
  );

  const tone =
    toast?.kind === 'success'
      ? { bg: colors.green, fg: colors.white }
      : toast?.kind === 'error'
        ? { bg: colors.danger, fg: colors.white }
        : { bg: colors.ink, fg: colors.white };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            left: spacing.lg,
            right: spacing.lg,
            bottom: insets.bottom + 90,
            opacity,
            transform: [{ translateY: translate }],
            ...shadows.overlay,
          }}
        >
          <View
            style={{
              backgroundColor: tone.bg,
              borderRadius: radius.card,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            {toast.kind === 'success' ? (
              <Check size={17} color={tone.fg} strokeWidth={2.4} />
            ) : toast.kind === 'error' ? (
              <AlertTriangle size={17} color={tone.fg} strokeWidth={2.2} />
            ) : (
              <Info size={17} color={tone.fg} strokeWidth={2.2} />
            )}
            <Text variant="bodySmall" color={tone.fg} style={{ flex: 1 }}>
              {toast.text}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
