/**
 * Circular initials avatar -- gold in the reference, which is the app's single
 * strongest accent. Used for the user, patients and practitioners.
 */

import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadows } from '@/theme';
import { initials as toInitials } from '@/utils/permissions';
import { Text } from './Text';

export type AvatarProps = {
  name?: string;
  size?: number;
  backgroundColor?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
};

export function Avatar({
  name,
  size = 40,
  backgroundColor = colors.goldAvatar,
  color = '#3A2E12',
  style,
  elevated = true,
}: AvatarProps) {
  return (
    <View
      accessible
      accessibilityLabel={name ? `${name} avatar` : 'Avatar'}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        elevated && shadows.raised,
        style,
      ]}
    >
      <Text
        style={{
          color,
          fontSize: Math.round(size * 0.34),
          lineHeight: Math.round(size * 0.4),
          fontFamily: 'Poppins_800ExtraBold',
        }}
      >
        {toInitials(name)}
      </Text>
    </View>
  );
}
