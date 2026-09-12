/**
 * Report viewer.
 *
 * These are ERPNext's own reports, and they are spreadsheets: Sales Register is
 * 24 columns. A phone is ~360pt wide, so the table scrolls horizontally with the
 * FIRST COLUMN PINNED -- the pattern a banking app uses for statements. Without
 * the pin you lose track of which row you are reading by column four.
 *
 * The grid is for checking a figure. Anything analytical belongs in the CSV,
 * which is why the export buttons are at the top rather than buried.
 *
 * Filters are built from the report's own declaration (`get_filters`), so this
 * one screen serves every report without knowing anything about them. Required
 * filters are pre-filled where the server can suggest a value -- most ERPNext
 * financial reports fail confusingly without `company` and a date range.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, SlidersHorizontal } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextField } from '@/components/form/TextField';
import { PickerField } from '@/components/form/PickerField';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as runner from '@/api/reportRunner';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { shareDownload } from '@/utils/download';
import { colors, radius, spacing } from '@/theme';

/** Wide enough to read a date or a document name without truncation. */
const COL_WIDTH = 132;
const FIRST_COL_WIDTH = 148;
const ROW_HEIGHT = 40;

export default function ReportViewerScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const reportName = decodeURIComponent(String(name ?? ''));
  const toast = useToast();

  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // The header scrolls sideways in lockstep with the body; see the table below.
  const headerScroll = useRef<ScrollView>(null);

  const filterInfo = useQuery({
    queryKey: queryKeys.report('filters', reportName),
    queryFn: () => runner.getReportFilters(reportName),
    enabled: Boolean(reportName),
  });

  // Seed the filters from the report's own defaults before the first run, so a
  // report that requires `company` does not fail on arrival.
  useEffect(() => {
    if (!filterInfo.data || ready) return;
    const seed: Record<string, unknown> = {};
    for (const f of filterInfo.data.filters) {
      if (f.default) seed[f.fieldname] = f.default;
      if (f.fieldname === 'company' && filterInfo.data.default_company) {
        seed.company = filterInfo.data.default_company;
      }
      if (f.fieldtype === 'Date' && !seed[f.fieldname]) {
        // from_date defaults to the start of the current month, to_date today:
        // running a year of data on arrival is slow and rarely what is wanted.
        if (f.fieldname.startsWith('from')) seed[f.fieldname] = monthStart(filterInfo.data.today);
        if (f.fieldname.startsWith('to') || f.fieldname.includes('date')) {
          seed[f.fieldname] = seed[f.fieldname] ?? filterInfo.data.today;
        }
      }
    }
    setFilters(seed);
    setReady(true);
  }, [filterInfo.data, ready]);

  const report = useQuery({
    queryKey: queryKeys.report(reportName, JSON.stringify(filters)),
    queryFn: () => runner.runReport(reportName, filters),
    enabled: Boolean(reportName) && ready,
    retry: false,
  });

  const download = useMutation({
    mutationFn: async (format: 'csv' | 'pdf') => {
      const payload =
        format === 'csv'
          ? await runner.downloadCsv(reportName, filters)
          : await runner.downloadPdf(reportName, filters);
      await shareDownload(payload, reportName);
      return format;
    },
    onSuccess: (format) => toast.success(`${format.toUpperCase()} ready to share`),
    onError: (error) => toast.error(messageForError(error)),
  });

  const columns = report.data?.columns ?? [];
  const rows = report.data?.rows ?? [];
  const [firstCol, ...restCols] = columns;

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v !== '' && v != null).length,
    [filters],
  );

  return (
    <Screen scroll={false}>
      <BackHeader
        title={reportName}
        subtitle={report.data ? `${report.data.total} rows` : 'Loading…'}
      />

      {/* Actions: filters left, exports right. Exports are prominent because a
          24-column grid is for checking, and the spreadsheet is for working. */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.pill,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <SlidersHorizontal size={15} color={colors.ink} strokeWidth={1.9} />
          <Text variant="micro">
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>

        <View style={{ flex: 1 }} />

        <IconAction
          label="CSV"
          icon={<FileSpreadsheet size={15} color={colors.green} strokeWidth={1.9} />}
          disabled={download.isPending || !report.data}
          onPress={() => download.mutate('csv')}
        />
        <IconAction
          label="PDF"
          icon={<Download size={15} color={colors.green} strokeWidth={1.9} />}
          disabled={download.isPending || !report.data}
          onPress={() => download.mutate('pdf')}
        />
      </View>

      {report.isPending || filterInfo.isPending ? (
        <SkeletonList count={6} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No data"
          message="This report returned nothing for those filters."
          action={{ label: 'Change filters', onPress: () => setSheetOpen(true) }}
        />
      ) : (
        <>
          {report.data?.truncated ? (
            <Card style={{ marginBottom: spacing.sm }} padding={spacing.md}>
              <Text variant="micro" muted>
                Showing the first {rows.length} of {report.data.total} rows. Export the
                CSV for the full report.
              </Text>
            </Card>
          ) : null}

          {/* Pinned first column + horizontally scrolling remainder.
              ONE vertical ScrollView wraps both panes, so the pinned column and
              the scrolling columns cannot drift out of step -- two independent
              scroll views would need their offsets synchronised by hand, and any
              dropped frame would misalign a row against its own label. */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row' }}>
              <HeaderCell label={firstCol?.label ?? ''} width={FIRST_COL_WIDTH} pinned />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEnabled={false}
                ref={headerScroll}
              >
                {restCols.map((c) => (
                  <HeaderCell key={c.fieldname} label={c.label} width={COL_WIDTH} />
                ))}
              </ScrollView>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row' }}>
                <View>
                  {rows.map((row, i) => (
                    <BodyCell
                      key={i}
                      value={row[firstCol?.fieldname ?? '']}
                      width={FIRST_COL_WIDTH}
                      zebra={i % 2 === 1}
                      pinned
                    />
                  ))}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEventThrottle={16}
                  // Drive the header from the body so the column labels track
                  // the data as it scrolls sideways.
                  onScroll={(e) =>
                    headerScroll.current?.scrollTo({
                      x: e.nativeEvent.contentOffset.x,
                      animated: false,
                    })
                  }
                >
                  <View>
                    {rows.map((row, i) => (
                      <View key={i} style={{ flexDirection: 'row' }}>
                        {restCols.map((c) => (
                          <BodyCell
                            key={c.fieldname}
                            value={row[c.fieldname]}
                            width={COL_WIDTH}
                            zebra={i % 2 === 1}
                            numeric={isNumeric(c.fieldtype)}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <View style={{ height: spacing.xxxl }} />
            </ScrollView>
          </View>
        </>
      )}

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {(filterInfo.data?.filters ?? []).length === 0 ? (
            <Text variant="caption" muted>
              This report takes no filters.
            </Text>
          ) : (
            (filterInfo.data?.filters ?? []).map((f) => (
              <FilterInput
                key={f.fieldname}
                def={f}
                value={filters[f.fieldname]}
                onChange={(v) => setFilters((prev) => ({ ...prev, [f.fieldname]: v }))}
              />
            ))
          )}
          <Button
            label="Apply"
            onPress={() => {
              setSheetOpen(false);
              void report.refetch();
            }}
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </BottomSheet>
    </Screen>
  );
}

function FilterInput({
  def,
  value,
  onChange,
}: {
  def: runner.ReportFilterDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = def.mandatory ? `${def.label} *` : def.label;

  if (def.fieldtype === 'Select' && def.options) {
    const options = def.options
      .split('\n')
      .filter(Boolean)
      .map((o) => ({ value: o, label: o }));
    return (
      <PickerField
        label={label}
        placeholder={`Choose ${def.label.toLowerCase()}`}
        value={(value as string) || null}
        options={options}
        onChange={onChange}
      />
    );
  }

  if (def.fieldtype === 'Check') {
    const on = Boolean(value);
    return (
      <PickerField
        label={label}
        placeholder="No"
        value={on ? '1' : '0'}
        options={[
          { value: '0', label: 'No' },
          { value: '1', label: 'Yes' },
        ]}
        onChange={(v) => onChange(v === '1' ? 1 : 0)}
      />
    );
  }

  // Date, Data, Link, Int, Float, Currency all take free text. A Link field
  // would ideally search its doctype, but the report filter set is open-ended
  // and a wrong guess at the target is worse than letting the user type.
  return (
    <TextField
      label={label}
      value={value == null ? '' : String(value)}
      onChangeText={onChange}
      placeholder={def.fieldtype === 'Date' ? 'YYYY-MM-DD' : def.label}
      keyboardType={isNumeric(def.fieldtype) ? 'numeric' : 'default'}
    />
  );
}

function HeaderCell({
  label,
  width,
  pinned,
}: {
  label: string;
  width: number;
  pinned?: boolean;
}) {
  return (
    <View
      style={{
        width,
        height: ROW_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        backgroundColor: pinned ? colors.mint : colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        borderRightWidth: pinned ? 1 : 0,
        borderRightColor: colors.line,
      }}
    >
      <Text variant="micro" numberOfLines={2} color={pinned ? colors.green : undefined}>
        {label}
      </Text>
    </View>
  );
}

function BodyCell({
  value,
  width,
  zebra,
  numeric,
  pinned,
}: {
  value: unknown;
  width: number;
  zebra?: boolean;
  numeric?: boolean;
  pinned?: boolean;
}) {
  return (
    <View
      style={{
        width,
        height: ROW_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        backgroundColor: pinned ? colors.card : zebra ? '#FAFAF8' : colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        borderRightWidth: pinned ? 1 : 0,
        borderRightColor: colors.line,
      }}
    >
      <Text
        variant="micro"
        numberOfLines={1}
        align={numeric ? 'right' : undefined}
        muted={!pinned}
      >
        {format(value)}
      </Text>
    </View>
  );
}

function IconAction({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Download ${label}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: colors.mint,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon}
      <Text variant="micro" color={colors.green}>
        {label}
      </Text>
    </Pressable>
  );
}

function isNumeric(fieldtype?: string) {
  return ['Currency', 'Float', 'Int', 'Percent'].includes(fieldtype ?? '');
}

/** Values arrive as whatever the report produced -- never assume a string. */
function format(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v);
}

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}
