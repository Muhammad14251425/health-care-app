/**
 * The patient app's floating bottom navigation.
 *
 * Same component language as the staff `TabBar` -- white rounded bar inset from
 * the edges, thin icons, dark green when active -- but with a fixed five-tab set
 * and no permission filtering, because a patient's tabs never vary:
 *
 *   Home · Appointments · Records · Billing · Me
 *
 * A separate component rather than a prop on the staff bar: that one branches on
 * staff permissions (`canViewBilling`, `canViewPatients`) which have no meaning
 * for a patient, and threading a mode flag through it would make both harder to
 * read for no shared behaviour.
 */

import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import {
  CalendarDays,
  CreditCard,
  FileText,
  Home,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';

const ICONS: Record<string, LucideIcon> = {
  index: Home,
  appointments: CalendarDays,
  records: FileText,
  billing: CreditCard,
  profile: User,
};

// Short enough to fit a fifth of a phone's width without ellipsising.
const LABELS: Record<string, string> = {
  index: 'Home',
  appointments: 'Visits',
  records: 'Records',
  billing: 'Billing',
  profile: 'Me',
};

export function PatientTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: Math.max(insets.bottom, spacing.md),
        height: 62,
        borderRadius: radius.nav,
        backgroundColor: 'rgba(255,255,255,0.98)',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
        ...shadows.nav,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const Icon = ICONS[route.name] ?? Home;
        const label = LABELS[route.name] ?? route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={{
              flex: 1,
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Icon
              size={19}
              color={focused ? colors.green : '#8B8D87'}
              strokeWidth={focused ? 2.2 : 1.6}
            />
            <Text
              style={[
                typography.micro,
                {
                  fontSize: 9,
                  lineHeight: 11,
                  color: focused ? colors.green : '#8B8D87',
                  fontFamily: focused ? 'Poppins_700Bold' : 'Poppins_500Medium',
                },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
