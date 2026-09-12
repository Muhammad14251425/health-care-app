/**
 * Save a base64 payload to disk and hand it to the OS share sheet.
 *
 * Downloads come back base64 rather than as a URL because a mobile client holds
 * a session cookie, not a browser: a plain link would arrive unauthenticated.
 * The bytes have to be on the device for the share sheet anyway.
 *
 * The CACHE directory is correct here. The OS may reclaim it under pressure,
 * which is fine -- every one of these files can be re-fetched, and a report
 * export is not something the user expects to find again later. Writing to
 * document storage instead would accumulate stale spreadsheets forever.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type Downloadable = {
  filename: string;
  mime_type: string;
  content: string;
};

/** iOS wants a UTI; Android ignores it. Wrong UTI = no apps offered. */
function utiFor(mimeType: string): string | undefined {
  if (mimeType === 'application/pdf') return 'com.adobe.pdf';
  if (mimeType === 'text/csv') return 'public.comma-separated-values-text';
  return undefined;
}

export async function shareDownload(payload: Downloadable, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const file = new File(Paths.cache, payload.filename);
  // Re-downloading the same report must overwrite, not append to, the old file.
  if (file.exists) file.delete();
  file.create();
  file.write(payload.content, { encoding: 'base64' });

  await Sharing.shareAsync(file.uri, {
    mimeType: payload.mime_type,
    dialogTitle,
    UTI: utiFor(payload.mime_type),
  });
}
