/**
 * Clinic wordmark -- the reference's `.eyebrow` + `.logo-dot`: a small dark
 * green dot with a pale highlight, followed by a lowercase name.
 */

import { View } from 'react-native';
import { colors, spacing, typography } from '@/theme';
import { Text } from './Text';

export function LogoMark({ size = 10 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.green,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: size * 0.2,
          top: -size * 0.2,
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: size * 0.19,
          backgroundColor: '#8EC5A8',
        }}
      />
    </View>
  );
}

export function Logo({ name = 'meadow clinic' }: { name?: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: 5,
      }}
    >
      <LogoMark />
      <Text style={[typography.label, { color: '#555952', fontSize: 11 }]}>{name}</Text>
    </View>
  );
}
