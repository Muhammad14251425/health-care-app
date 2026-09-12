/**
 * Select-style field that opens a searchable bottom sheet.
 *
 * Used for patient and practitioner selection, where the list is long enough
 * that a wheel picker or inline list would be unusable.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/components/ui/Text';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SearchBar } from '@/components/ui/SearchBar';

export type PickerOption = {
  value: string;
  label: string;
  description?: string;
};

export type PickerFieldProps = {
  label: string;
  placeholder?: string;
  value: string | null;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Show a search box inside the sheet. */
  searchable?: boolean;
  /** External search (server-side) instead of filtering in memory. */
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  emptyMessage?: string;
  footer?: ReactNode;
};

export function PickerField({
  label,
  placeholder = 'Select',
  value,
  options,
  onChange,
  searchable = false,
  onSearchChange,
  loading = false,
  disabled = false,
  error,
  emptyMessage = 'Nothing to choose from',
  footer,
}: PickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    // When the parent handles searching, never filter again locally.
    if (onSearchChange || !search.trim()) return options;
    const needle = search.trim().toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.description?.toLowerCase().includes(needle),
    );
  }, [options, search, onSearchChange]);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
        {label}
      </Text>

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected?.label ?? placeholder}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderRadius: radius.card,
          paddingHorizontal: spacing.lg,
          minHeight: 52,
          borderWidth: 1.5,
          borderColor: error ? colors.danger : colors.line,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text
          variant="body"
          color={selected ? colors.ink : colors.muted}
          style={{ flex: 1 }}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={colors.muted} strokeWidth={1.8} />
      </Pressable>

      {error ? (
        <Text variant="micro" color={colors.danger} style={{ marginTop: 6 }}>
          {error}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        {searchable ? (
          <View style={{ marginBottom: spacing.md }}>
            <SearchBar
              value={search}
              onChangeText={(next) => {
                setSearch(next);
                onSearchChange?.(next);
              }}
              placeholder={`Search ${label.toLowerCase()}`}
            />
          </View>
        ) : null}

        <FlatList
          data={visible}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.line }} />
          )}
          ListEmptyComponent={
            <Text variant="caption" muted align="center" style={{ paddingVertical: spacing.xl }}>
              {loading ? 'Loading…' : emptyMessage}
            </Text>
          }
          renderItem={({ item }) => {
            const isSelected = item.value === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                  setSearch('');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall">{item.label}</Text>
                  {item.description ? (
                    <Text variant="micro" muted style={{ marginTop: 2 }}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Check size={17} color={colors.green} strokeWidth={2.4} />
                ) : null}
              </Pressable>
            );
          }}
        />
        {footer}
      </BottomSheet>
    </View>
  );
}
