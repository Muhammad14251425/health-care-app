/**
 * Screen scaffolding.
 *
 * Uses react-native-safe-area-context (never the deprecated SafeAreaView) so
 * content clears notches and gesture bars on real hardware. The reference's
 * fake phone frame is deliberately NOT reproduced.
 */

import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, screenPadding, spacing, tabBarClearance } from '@/theme';

export type ScreenProps = {
  children: ReactNode;
  /** Wrap children in a ScrollView. Set false for FlatList-based screens. */
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra bottom space so content clears the floating tab bar. */
  withTabBar?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
};

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  withTabBar = false,
  padded = true,
  style,
  contentStyle,
  backgroundColor = colors.bg,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const paddingBottom = withTabBar ? tabBarClearance : Math.max(insets.bottom, spacing.lg);

  // `insets.top` only clears the status bar -- it leaves the page title sitting
  // directly against the clock and battery icons. This adds a deliberate gap so
  // headings breathe, matching the space above "Hello Peace" in the reference.
  const paddingTop = insets.top + spacing.lg;

  const body = (
    <View
      style={[
        { flex: scroll ? 0 : 1, paddingHorizontal: padded ? screenPadding : 0 },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View style={[{ flex: 1, backgroundColor, paddingTop }, style]}>
      <StatusBar style="dark" />
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.green}
                colors={[colors.green]}
              />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: withTabBar ? 0 : paddingBottom }}>{body}</View>
      )}
    </View>
  );
}
