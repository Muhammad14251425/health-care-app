/**
 * Empty / error / loading states.
 *
 * Skeletons mirror the real row geometry so the layout does not jump when data
 * arrives -- a full-screen spinner is never used for list content.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';
import { CloudOff, Lock, RefreshCw, SearchX } from 'lucide-react-native';
import { colors, radius, spacing } from '@/theme';
import { ApiError } from '@/api/errors';
import { Button } from './Button';
import { Card } from './Card';
import { Text } from './Text';

// --------------------------------------------------------------------------- //
// Empty
// --------------------------------------------------------------------------- //

export type EmptyStateProps = {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 1.5, gap: spacing.md }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: colors.mint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ?? <SearchX size={24} color={colors.green} strokeWidth={1.6} />}
      </View>
      <Text variant="cardTitle" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="caption" muted align="center" style={{ maxWidth: 260 }}>
          {message}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: spacing.sm, minWidth: 180 }}>
          <Button label={action.label} onPress={action.onPress} size="sm" />
        </View>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------------------- //
// Error
// --------------------------------------------------------------------------- //

export type ErrorStateProps = {
  error: unknown;
  onRetry?: () => void;
  /** Override the headline; the message still comes from the error. */
  title?: string;
};

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const apiError = error instanceof ApiError ? error : null;
  const offline = apiError?.isOffline ?? false;
  const forbidden = apiError?.isPermissionFailure ?? false;

  const heading =
    title ?? (offline ? 'No internet connection' : forbidden ? 'Not available to you' : 'Something went wrong');

  const message =
    apiError?.message ??
    'We could not load this right now. Please try again in a moment.';

  const icon = offline ? (
    <CloudOff size={24} color={colors.brown} strokeWidth={1.6} />
  ) : forbidden ? (
    <Lock size={24} color={colors.brown} strokeWidth={1.6} />
  ) : (
    <RefreshCw size={24} color={colors.brown} strokeWidth={1.6} />
  );

  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.md }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: colors.peach,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Text variant="cardTitle" align="center">
        {heading}
      </Text>
      <Text variant="caption" muted align="center" style={{ maxWidth: 280 }}>
        {message}
      </Text>
      {/* A permission failure is not retryable -- offering Retry would mislead. */}
      {onRetry && !forbidden ? (
        <View style={{ marginTop: spacing.sm, minWidth: 180 }}>
          <Button label="Try again" onPress={onRetry} size="sm" variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------------------- //
// Skeletons
// --------------------------------------------------------------------------- //

function useShimmer() {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

export function SkeletonBlock({
  width = '100%',
  height = 12,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: 6, backgroundColor: colors.line, opacity },
        style,
      ]}
    />
  );
}

/** Matches the geometry of a patient / appointment list row. */
export function SkeletonRow() {
  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <SkeletonBlock width={44} height={44} style={{ borderRadius: radius.pill }} />
        <View style={{ flex: 1, gap: spacing.sm }}>
          <SkeletonBlock width="60%" height={13} />
          <SkeletonBlock width="40%" height={10} />
        </View>
        <SkeletonBlock width={54} height={20} style={{ borderRadius: radius.pill }} />
      </View>
    </Card>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

/** Matches the dashboard hero card. */
export function SkeletonHero() {
  return (
    <View
      style={{
        height: 190,
        borderRadius: radius.hero,
        backgroundColor: colors.line,
        marginBottom: spacing.xl,
      }}
    />
  );
}
