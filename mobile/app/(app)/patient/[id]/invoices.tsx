/**
 * One patient's invoices.
 *
 * A drill-down from the patient profile, deliberately OUTSIDE the (tabs) group.
 * Routing to the Billing tab with a `?patient=` filter looked simpler, but a tab
 * is a destination rather than a step: the tab bar stayed visible with Billing
 * lit up, and Android back went to the previous TAB instead of back to the
 * patient. Its own route gets a real back stack and no tab chrome.
 *
 * The list itself is the Billing screen's, reused rather than copied so the two
 * cannot drift apart in how they render, filter or refresh invoices.
 */

import { useLocalSearchParams } from 'expo-router';

import BillingScreen from '../../(tabs)/billing';

export default function PatientInvoices() {
  const params = useLocalSearchParams<{ id?: string }>();
  const patient = params.id ? decodeURIComponent(params.id) : undefined;

  // BillingScreen reads `patient` from the route, and this route carries the
  // patient in `id`, so hand it across explicitly.
  return <BillingScreen patientOverride={patient} />;
}
