import { useId, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import {
  downloadMessageAttachment,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_TYPES,
  MESSAGE_ATTACHMENTS_MAX_PER_MESSAGE,
  uploadMessageAttachment,
} from '../api/endpoints';
import type { MessageAttachment } from '../api/endpoints';

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

/** A size a person reads: "820 KB", "2.4 MB". */
export function formatAttachmentSize(bytes: number): string {
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
}

/**
 * Why `file` cannot be attached, as an i18n key, or `null` if it can.
 * A first check for a quick answer; the API checks the bytes regardless.
 */
export function attachmentProblem(file: File): string | null {
  if (!(MESSAGE_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return 'messages.attachmentWrongType';
  if (file.size === 0) return 'messages.attachmentEmpty';
  if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) return 'messages.attachmentTooLarge';
  return null;
}

/** A file that could not be attached after the message was sent. */
export interface FailedAttachment {
  name: string;
  reason: string;
}

/**
 * Attach `files` to the message the caller just sent, one at a time.
 * Returns the files that failed and the server's reason for each: the message
 * itself was sent, so a failure here is reported, never hidden.
 */
export async function attachFilesToMessage(messageId: string, files: File[]): Promise<FailedAttachment[]> {
  const failed: FailedAttachment[] = [];
  for (const file of files) {
    try {
      await uploadMessageAttachment(messageId, file);
    } catch (error) {
      failed.push({ name: file.name, reason: error instanceof Error ? error.message : '' });
    }
  }
  return failed;
}

interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** "Attach files" with the chosen files listed, each removable. */
export function AttachmentPicker({ files, onChange, disabled }: AttachmentPickerProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');

  const add = (chosen: FileList | null) => {
    const next = [...files];
    let firstProblem = '';
    for (const file of Array.from(chosen ?? [])) {
      const issue = next.length >= MESSAGE_ATTACHMENTS_MAX_PER_MESSAGE ? 'messages.attachmentTooMany' : attachmentProblem(file);
      if (issue) firstProblem ||= t(issue, { name: file.name, max: String(MESSAGE_ATTACHMENTS_MAX_PER_MESSAGE) });
      else next.push(file);
    }
    setProblem(firstProblem);
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-1">
      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-content-secondary hover:bg-surface-sunken focus-within:ring-2 focus-within:ring-focus ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {t('messages.attachFiles')}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          disabled={disabled}
          accept={MESSAGE_ATTACHMENT_TYPES.join(',')}
          onChange={(e) => add(e.target.files)}
          className="sr-only"
        />
      </label>
      <p className="text-xs text-content-muted">{t('messages.attachmentRules')}</p>
      {problem && <p role="alert" className="text-xs text-critical-subtle-fg">{problem}</p>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('messages.chosenFiles')}>
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full bg-surface-sunken px-3 py-1 text-xs text-content">
              {file.name} ({formatAttachmentSize(file.size)})
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label={t('messages.removeFile', { name: file.name })}
                className="rounded-full p-0.5 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Save a downloaded blob under `filename` through a temporary link. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** One attachment as a download button, labelled when it was not scanned. */
function AttachmentItem({ attachment }: { attachment: MessageAttachment }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Icon = attachment.content_type === 'application/pdf' ? FileText : ImageIcon;

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const { blob } = await downloadMessageAttachment(attachment.id);
      saveBlob(blob, attachment.filename);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('messages.attachmentDownloadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-0.5">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left text-xs text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
        <span className="font-medium">{attachment.filename}</span>
        <span className="text-content-muted">{formatAttachmentSize(attachment.size_bytes)}</span>
        <Download className="h-3 w-3" aria-hidden="true" />
      </button>
      {attachment.scan_status === 'not_scanned' && (
        <p className="text-xs text-caution-subtle-fg">{t('messages.attachmentNotScanned')}</p>
      )}
      {error && <p role="alert" className="text-xs text-critical-subtle-fg">{error}</p>}
    </li>
  );
}

/** The files on one message, each downloadable. Renders nothing when none. */
export function MessageAttachmentList({ attachments }: { attachments?: MessageAttachment[] }) {
  const { t } = useTranslation();
  if (!attachments || attachments.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" aria-label={t('messages.attachmentsLabel')}>
      {attachments.map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} />
      ))}
    </ul>
  );
}
