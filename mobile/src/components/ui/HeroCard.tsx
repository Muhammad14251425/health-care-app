/**
 * The dark-green hero card -- the reference's `.balance-card`, translated from
 * finance to clinic data.
 *
 * Faithful details from the reference, because they are what make it read as
 * Baobab rather than a generic dark panel:
 *   * a 145deg gradient through three greens
 *   * a soft mint disc bleeding off the top-right corner
 *   * a thin gold arc suggesting a baobab branch
 *   * a row of small actions along the bottom, the first one gold
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

export type HeroAction = {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  /** The gold, primary-looking action. Use for at most one. */
  primary?: boolean;
};

export type HeroCardProps = {
  label: string;
  value: string;
  caption?: string;
  actions?: HeroAction[];
  right?: ReactNode;
};

export function HeroCard({ label, value, caption, actions = [], right }: HeroCardProps) {
  return (
    <LinearGradient
      colors={[...colors.greenGradient]}
      locations={[0, 0.68, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: radius.hero,
        padding: spacing.xl,
        overflow: 'hidden',
      }}
    >
      {/* Soft disc bleeding off the top-right, as in the reference. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: -34,
          top: -22,
          width: 116,
          height: 74,
          borderRadius: 58,
          backgroundColor: colors.greenGlow,
          opacity: 0.45,
        }}
      />

      {/* The gold branch arc. */}
      <Svg
        width={44}
        height={116}
        viewBox="0 0 44 116"
        style={{ position: 'absolute', right: 16, top: 44, opacity: 0.85 }}
        pointerEvents="none"
      >
        <Path
          d="M34 2 C 8 34, 8 82, 30 114"
          stroke="#BD9250"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.78)' }}>
            {label}
          </Text>
          <Text style={[typography.display, { color: colors.white, marginTop: spacing.sm }]}>
            {value}
          </Text>
          {caption ? (
            <Text
              variant="caption"
              style={{ color: 'rgba(255,255,255,0.86)', marginTop: spacing.sm }}
            >
              {caption}
            </Text>
          ) : null}
        </View>
        {right}
      </View>

      {actions.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={{
                flex: 1,
                height: 42,
                borderRadius: radius.md,
                backgroundColor: action.primary ? colors.gold : colors.greenAction,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 5,
                paddingHorizontal: spacing.xs,
              }}
            >
              {action.icon}
              <Text
                style={[
                  typography.micro,
                  { color: action.primary ? '#2E2A1D' : colors.white },
                ]}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}
