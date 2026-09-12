/**
 * Reports.
 *
 * ERPNext ships ~200 desk reports and they stay at /app/report -- they return a
 * spreadsheet grid that is unreadable on a phone. This screen answers the
 * questions a clinic actually asks, with figures sized for a thumb.
 *
 * Revenue appears only for roles the backend grants billing to. A doctor sees
 * the clinical half and no empty money card; asking for it anyway returns 403,
 * which renders as a permission message rather than a crash.
 *
 * The chart is drawn with plain Views. A charting library would add ~200KB to
 * the bundle to draw twelve bars.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQueries } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { StatCard, StatCardRow } from '@/components/ui/StatCard';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as reportsApi from '@/api/reports';
import { PERIOD_LABELS, type ReportPeriod } from '@/api/reports';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { formatCurrencyCompact } from '@/utils/currency';
import { colors, radius, spacing } from '@/theme';

export default function ReportsScreen() {
  const { canViewBilling } = usePermissions();
  const [period, setPeriod] = useState<ReportPeriod>('month');

  const [overview, trend, doctors, revenue, diagnoses] = useQueries({
    queries: [
      {
        queryKey: queryKeys.report('overview', period),
        queryFn: () => reportsApi.overview(period),
      },
      {
        queryKey: queryKeys.report('trend', period),
        queryFn: () => reportsApi.appointmentsTrend(period),
      },
      {
        queryKey: queryKeys.report('doctors', period),
        queryFn: () => reportsApi.byPractitioner(period),
      },
      {
        queryKey: queryKeys.report('revenue', period),
        queryFn: () => reportsApi.revenue(period),
        // Never fire this for a doctor: the server would refuse it, and a 403 in
        // the console on every period change looks like a bug.
        enabled: canViewBilling,
      },
      {
        queryKey: queryKeys.report('diagnoses', period),
        queryFn: () => reportsApi.topDiagnoses(period),
      },
    ],
  });

  const appt = overview.data?.appointments;
  const money = overview.data?.revenue;

  const refetchAll = () => {
    void overview.refetch();
    void trend.refetch();
    void doctors.refetch();
    void diagnoses.refetch();
    if (canViewBilling) void revenue.refetch();
  };

  return (
    <Screen onRefresh={refetchAll} refreshing={overview.isRefetching}>
      <BackHeader title="Reports" subtitle="How the clinic is doing" />

      <View style={{ marginBottom: spacing.lg }}>
        <FilterPillRow options={PERIOD_LABELS} value={period} onChange={setPeriod} />
      </View>

      {overview.isPending ? (
        <SkeletonList count={4} />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <Text variant="micro" muted style={{ marginBottom: spacing.md }}>
            {overview.data?.from_date} to {overview.data?.to_date}
          </Text>

          {/* --- appointments --- */}
          <SectionHeader title="Appointments" />
          <StatCardRow>
            <StatCard label="Booked" value={appt?.total ?? 0} backgroundColor={colors.peach} />
            <StatCard label="Attended" value={appt?.attended ?? 0} backgroundColor={colors.mint} />
            <StatCard
              label="Cancelled"
              value={appt?.cancelled ?? 0}
              backgroundColor={colors.paleYellow}
            />
          </StatCardRow>

          <Card style={{ marginTop: spacing.sm }}>
            <Row label="Cancellation rate" value={`${appt?.cancellation_rate ?? 0}%`} />
            <Row label="No-show rate" value={`${appt?.no_show_rate ?? 0}%`} />
            <Row label="Still scheduled" value={String(appt?.scheduled ?? 0)} last />
          </Card>

          {/* --- daily volume --- */}
          <SectionHeader title="Daily volume" style={{ marginTop: spacing.xl }} />
          {trend.isPending ? (
            <SkeletonList count={1} />
          ) : trend.data && trend.data.total > 0 ? (
            <Card>
              <MiniBars series={trend.data.series} peak={trend.data.peak} />
              <Text variant="micro" muted style={{ marginTop: spacing.sm }} align="center">
                {trend.data.total} appointments · busiest day {trend.data.peak}
              </Text>
            </Card>
          ) : (
            <EmptyState title="No appointments" message="Nothing booked in this period." />
          )}

          {/* --- clinical activity --- */}
          <SectionHeader title="Clinical activity" style={{ marginTop: spacing.xl }} />
          <StatCardRow>
            <StatCard
              label="Consultations"
              value={overview.data?.encounters ?? 0}
              backgroundColor={colors.mint}
            />
            <StatCard
              label="New patients"
              value={overview.data?.new_patients ?? 0}
              backgroundColor={colors.peach}
            />
          </StatCardRow>

          {/* --- money: billing roles only --- */}
          {canViewBilling && money ? (
            <>
              <SectionHeader title="Revenue" style={{ marginTop: spacing.xl }} />
              <StatCardRow>
                <StatCard
                  label="Billed"
                  value={formatCurrencyCompact(money.billed, money.currency)}
                  backgroundColor={colors.mint}
                />
                <StatCard
                  label="Collected"
                  value={formatCurrencyCompact(money.collected, money.currency)}
                  backgroundColor={colors.paleYellow}
                />
                <StatCard
                  label="Outstanding"
                  value={formatCurrencyCompact(money.outstanding, money.currency)}
                  backgroundColor={colors.peach}
                />
              </StatCardRow>
              <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
                {money.invoices} invoice{money.invoices === 1 ? '' : 's'} in this period
              </Text>

              {(revenue.data?.outstanding_by_patient?.length ?? 0) > 0 ? (
                <>
                  <SectionHeader title="Owed by patient" style={{ marginTop: spacing.lg }} />
                  <Card>
                    {revenue.data!.outstanding_by_patient.map((d, i, arr) => (
                      <Row
                        key={d.patient}
                        label={d.patient_name}
                        value={formatCurrencyCompact(d.due, money.currency)}
                        last={i === arr.length - 1}
                      />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}

          {/* --- per doctor --- */}
          <SectionHeader title="By doctor" style={{ marginTop: spacing.xl }} />
          {doctors.isPending ? (
            <SkeletonList count={2} />
          ) : (doctors.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No activity" message="No appointments in this period." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {doctors.data!.items.map((d) => (
                <Card key={d.practitioner}>
                  <Text variant="cardTitle" numberOfLines={1}>
                    {d.practitioner_name}
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.lg }}>
                    <Metric label="Booked" value={d.appointments} />
                    <Metric label="Seen" value={d.attended} />
                    <Metric label="Cancelled" value={d.cancelled} />
                    <Metric label="Notes" value={d.encounters} />
                  </View>
                </Card>
              ))}
            </View>
          )}

          {/* --- diagnoses --- */}
          <SectionHeader title="Top diagnoses" style={{ marginTop: spacing.xl }} />
          {diagnoses.isPending ? (
            <SkeletonList count={2} />
          ) : (diagnoses.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="Nothing recorded" message="No diagnoses in this period." />
          ) : (
            <Card>
              {diagnoses.data!.items.map((d, i, arr) => (
                <Row
                  key={`${d.diagnosis}-${i}`}
                  label={d.diagnosis}
                  value={String(d.count)}
                  last={i === arr.length - 1}
                />
              ))}
            </Card>
          )}

          <View style={{ height: spacing.xxxl }} />
        </>
      )}
    </Screen>
  );
}

/**
 * Bar chart, drawn with Views.
 *
 * Long periods are bucketed: a year is 365 points and a phone is ~340px wide,
 * so drawing every day would render sub-pixel bars. Bucketing keeps each bar
 * wide enough to see and the shape honest.
 */
function MiniBars({ series, peak }: { series: reportsApi.TrendPoint[]; peak: number }) {
  const bars = useMemo(() => {
    const MAX = 30;
    if (series.length <= MAX) return series.map((p) => p.count);

    const size = Math.ceil(series.length / MAX);
    const out: number[] = [];
    for (let i = 0; i < series.length; i += size) {
      out.push(series.slice(i, i + size).reduce((sum, p) => sum + p.count, 0));
    }
    return out;
  }, [series]);

  const max = Math.max(peak, ...bars, 1);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 2 }}
      accessibilityRole="image"
      accessibilityLabel={`Appointment volume chart, peak ${peak} in a day`}
    >
      {bars.map((value, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            // A zero day still gets a hairline, so gaps read as "none" rather
            // than as missing data.
            height: value === 0 ? 2 : Math.max(4, (value / max) * 96),
            backgroundColor: value === 0 ? colors.line : colors.green,
            borderRadius: 2,
          }}
        />
      ))}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
        gap: spacing.md,
      }}
    >
      <Text variant="bodySmall" muted style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      <Text variant="cardTitle">{value}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View>
      <Text variant="cardTitle">{value}</Text>
      <Text variant="micro" muted>
        {label}
      </Text>
    </View>
  );
}
