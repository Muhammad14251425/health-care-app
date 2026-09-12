/**
 * Bottom sheet built on RN's Modal.
 *
 * A dedicated sheet library would be heavier than this screen set needs; Modal
 * plus a slide animation matches the design and keeps the dependency list small.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/theme';
import { Text } from './Text';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Cap the height so a long list scrolls instead of covering the screen. */
  maxHeightRatio?: number;
  contentStyle?: StyleProp<ViewStyle>;
};

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.8,
  contentStyle,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const translate = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translate, {
        toValue: 0,
        useNativeDriver: true,
        speed: 16,
        bounciness: 2,
      }).start();
    } else {
      translate.setValue(400);
    }
  }, [visible, translate]);

  const maxHeight = Dimensions.get('window').height * maxHeightRatio;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(16,17,15,0.35)', justifyContent: 'flex-end' }}
      >
        {/* Stop taps inside the sheet from closing it. */}
        <Pressable onPress={(event) => event.stopPropagation()}>
          <Animated.View
            style={[
              {
                backgroundColor: colors.bg,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingTop: spacing.md,
                paddingBottom: Math.max(insets.bottom, spacing.lg),
                paddingHorizontal: spacing.lg,
                maxHeight,
                transform: [{ translateY: translate }],
              },
              contentStyle,
            ]}
          >
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.line,
                alignSelf: 'center',
                marginBottom: spacing.lg,
              }}
            />
            {title ? (
              <Text variant="heading3" style={{ marginBottom: spacing.lg }}>
                {title}
              </Text>
            ) : null}
            {children}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
