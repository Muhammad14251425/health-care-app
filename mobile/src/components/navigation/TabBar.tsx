/**
 * The floating bottom navigation from the reference: a white rounded rectangle
 * inset from the screen edges, resting above the content with a soft shadow.
 * Small thin icons, small labels, dark green when active.
 *
 * This is a custom tabBar rather than the default React Navigation one, which
 * renders a full-width bar attached to the screen edge -- visually the opposite
 * of the reference.
 */

import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Expo Router ships its own bottom-tabs types, which diverge slightly from the
// standalone @react-navigation/bottom-tabs package (ColorValue vs string in the
// header options). Since the <Tabs> here is Expo Router's, take the type from
// the same place rather than mixing the two.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import {
  Activity,
  CalendarDays,
  CreditCard,
  Home,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';
import { usePermissions } from '@/stores/auth';

const ICONS: Record<string, LucideIcon> = {
  index: Home,
  appointments: CalendarDays,
  patients: Users,
  billing: CreditCard,
  activity: Activity,
  profile: User,
};

// Short enough to fit a fifth of a phone's width without ellipsising --
// "Appointments" truncates to "Appointm…" even at 9px.
const LABELS: Record<string, string> = {
  index: 'Home',
  appointments: 'Schedule',
  patients: 'Patients',
  billing: 'Billing',
  activity: 'Activity',
  profile: 'Me',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { canViewBilling, canViewPatients } = usePermissions();

  // `href: null` in the Tabs layout does not reliably remove a route from
  // `state.routes`, so the bar would render six tabs (Billing AND Activity).
  // Filter here instead: Activity exists specifically to take Billing's slot for
  // users the backend refuses invoice access to, so exactly one of them shows.
  const routes = state.routes.filter((route) => {
    if (route.name === 'billing') return canViewBilling;
    if (route.name === 'activity') return !canViewBilling;
    if (route.name === 'patients') return canViewPatients;
    return true;
  });

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
      {routes.map((route) => {
        // Compare by key, not index: `routes` is filtered, so its indices no
        // longer line up with `state.index`.
        const focused = state.routes[state.index]?.key === route.key;
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
