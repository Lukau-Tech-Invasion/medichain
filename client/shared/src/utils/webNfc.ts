/**
 * Reading and writing a MediChain card over Web NFC.
 *
 * Web NFC exists only in Chrome on Android (not iOS, not desktop), on an
 * https:// page, after a tap. A card carries one NDEF text record: the card id
 * the emergency endpoint looks up (`nfc_tags.id`, the `card_id` the clinic
 * issued). A phone cannot pretend to be a card from a web page; that needs an
 * installed app, so a phone-to-phone tap is not offered here.
 */

interface NdefRecordLike {
  recordType: string;
  encoding?: string;
  data?: DataView;
}
interface NdefReadingEvent extends Event {
  serialNumber?: string;
  message: { records: NdefRecordLike[] };
}
interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: Array<{ recordType: string; data: string }> }, options?: { signal?: AbortSignal }): Promise<void>;
}
type NdefReaderConstructor = new () => NdefReaderLike;

function readerClass(): NdefReaderConstructor | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { NDEFReader?: NdefReaderConstructor }).NDEFReader;
}

/** Whether this browser can read and write NFC cards at all. */
export function nfcSupported(): boolean {
  return readerClass() !== undefined;
}

/** A sentence a person can act on, for each way Web NFC fails. */
export function nfcErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'NFC permission was refused. Allow NFC for this site in Chrome (tap the icon beside the web address, then Permissions), then try again.';
    case 'NotSupportedError':
      return 'NFC is switched off or not available. Turn on NFC in the phone settings, or enter the card number by hand.';
    case 'NotReadableError':
      return 'The card could not be read. Hold it still against the back of the phone and try again.';
    case 'AbortError':
      return 'Stopped.';
    default:
      return 'The card could not be read. Enter the card number by hand instead.';
  }
}

/** The text a card carries, or `null` when it holds no text record. */
export function textOfRecords(records: NdefRecordLike[]): string | null {
  for (const record of records) {
    if ((record.recordType === 'text' || record.recordType === 'url') && record.data) {
      const text = new TextDecoder(record.encoding || 'utf-8').decode(record.data).trim();
      if (text) return text;
    }
  }
  return null;
}

/**
 * Wait for one card and return its text. Starting the scan shows Chrome's NFC
 * permission prompt the first time. Abort `signal` to stop listening.
 */
export async function readNfcCardOnce(signal: AbortSignal): Promise<string> {
  const Reader = readerClass();
  if (!Reader) throw new DOMException('Web NFC is not available', 'NotSupportedError');
  const reader = new Reader();
  return new Promise<string>((resolve, reject) => {
    const stopOnAbort = () => reject(new DOMException('Stopped', 'AbortError'));
    signal.addEventListener('abort', stopOnAbort, { once: true });
    reader.addEventListener('reading', (event) => {
      const text = textOfRecords((event as NdefReadingEvent).message.records);
      if (text) resolve(text);
      else reject(new DOMException('This card holds no MediChain number', 'NotReadableError'));
    });
    reader.addEventListener('readingerror', () =>
      reject(new DOMException('The card could not be read', 'NotReadableError'))
    );
    reader.scan({ signal }).catch(reject);
  });
}

/** Write `text` onto the next card or sticker held to the phone. */
export async function writeNfcCard(text: string, signal?: AbortSignal): Promise<void> {
  const Reader = readerClass();
  if (!Reader) throw new DOMException('Web NFC is not available', 'NotSupportedError');
  await new Reader().write({ records: [{ recordType: 'text', data: text }] }, { signal });
}
