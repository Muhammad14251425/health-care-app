/**
 * Search field with an optional filter button.
 *
 * Debouncing lives in the hook that consumes the value (useDebouncedValue), so
 * this component stays fully controlled and instant to type in.
 */

import { Pressable, TextInput, View } from 'react-native';
import { Search, SlidersHorizontal, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, typography } from '@/theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onFilterPress?: () => void;
  autoFocus?: boolean;
};

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onFilterPress,
  autoFocus = false,
}: SearchBarProps) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.card,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          height: 46,
          ...shadows.card,
        }}
      >
        <Search size={17} color={colors.muted} strokeWidth={1.8} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={placeholder}
          style={[typography.body, { flex: 1, color: colors.ink, padding: 0 }]}
        />
        {value.length > 0 ? (
          <Pressable
            onPress={() => onChangeText('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
          >
            <X size={16} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      {onFilterPress ? (
        <Pressable
          onPress={onFilterPress}
          accessibilityRole="button"
          accessibilityLabel="Filter"
          style={{
            width: 46,
            height: 46,
            borderRadius: radius.pill,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadows.card,
          }}
        >
          <SlidersHorizontal size={17} color={colors.ink} strokeWidth={1.8} />
        </Pressable>
      ) : null}
    </View>
  );
}
