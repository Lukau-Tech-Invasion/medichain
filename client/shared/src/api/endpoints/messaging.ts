/**
 * MediChain API endpoints: Messages, notifications, SMS and push registration.
 */

import { getApiClient } from '../client';
import { readFileBytes } from './common';

// ============================================================================
// SMS Preferences (Phase 5.3)
// ============================================================================

// ============================================================================
// Push Notifications (Phase 5.2 — FCM device registration)
// ============================================================================

export async function registerDeviceToken(
  token: string,
  deviceType?: string,
  deviceName?: string
): Promise<{ success: boolean; status: string }> {
  return getApiClient().post('/api/notifications/register-device', {
    token,
    device_type: deviceType,
    device_name: deviceName,
  });
}

// ============================================================================
// Messaging & Notifications
// ============================================================================

/**
 * Send a secure message
 */
export interface SecureMessage {
  message_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  recipient_id: string;
  recipient_name?: string;
  subject: string;
  content: string;
  priority: string;
  related_patient_id: string | null;
  sent_at: number;
  read: boolean;
  thread_id: string;
  /** Files attached to this message (WP7.2); absent on older responses. */
  attachments?: MessageAttachment[];
}

/** A file attached to a secure message. The bytes are fetched on demand. */
export interface MessageAttachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  size_bytes: number;
  /** `not_scanned` when no malware scanner is set up; the UI says so. */
  scan_status: 'clean' | 'not_scanned';
  created_at: string;
}

/** Largest attachment the API accepts, in bytes (10 MB). */
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Most attachments one message may carry. */
export const MESSAGE_ATTACHMENTS_MAX_PER_MESSAGE = 5;
/** The only attachment types the API accepts (it checks the bytes too). */
export const MESSAGE_ATTACHMENT_TYPES: ReadonlyArray<MessageAttachment['content_type']> = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

/** Attach one file to a message the caller has sent. */
export async function uploadMessageAttachment(
  messageId: string,
  file: File
): Promise<{ success: boolean; attachment: MessageAttachment }> {
  const bytes = await readFileBytes(file);
  return getApiClient().postBinary(
    `/api/messages/${encodeURIComponent(messageId)}/attachments?filename=${encodeURIComponent(file.name)}`,
    bytes,
    file.type
  );
}

/** Download an attachment's bytes (conversation participants only; audited). */
export async function downloadMessageAttachment(
  attachmentId: string
): Promise<{ blob: Blob; contentType: string }> {
  return getApiClient().getBlob(`/api/messages/attachments/${encodeURIComponent(attachmentId)}`);
}

export interface MessageConversation {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string | null;
  specialty: string | null;
  lastMessage: string | null;
  lastMessageTime: number | null;
  unreadCount: number;
  messages: SecureMessage[];
}

export interface SecureMessagesResponse {
  success: boolean;
  folder: string;
  messages: SecureMessage[];
  conversations: MessageConversation[];
  count: number;
  unread_count: number;
}

export async function sendMessage(data: {
  recipient_id: string;
  /** Omitted rather than sent empty: a reply need not carry one. */
  subject?: string;
  content: string;
  priority?: string;
  related_patient_id?: string;
  thread_id?: string;
  reply_to?: string;
}): Promise<{ success: boolean; message: SecureMessage; info: string }> {
  return getApiClient().post('/api/messages/send', data);
}

/** Who the signed-in account can write to. */
export interface MessageRecipients {
  success: boolean;
  staff: Array<{ user_id: string; name: string; role: string; specialty?: string | null }>;
  /** Patients the caller is treating; always empty for a patient caller. */
  patients: Array<{ user_id: string; name: string; patient_id: string }>;
}

/**
 * Staff, and the patients the caller is treating (a patient's grant, a care
 * relationship from an appointment, consultation or referral, or emergency
 * access). The server refuses a message to any other patient.
 */
export async function getMessageRecipients(): Promise<MessageRecipients> {
  // Two lists side by side: without keepEnvelope the client unwraps the body
  // to its `patients` array and the staff list is lost.
  return getApiClient().get('/api/messages/recipients', { keepEnvelope: true });
}

/** The caller's persisted message copies, optionally limited to a mailbox. */
export async function getMessages(folder: 'inbox' | 'sent' | 'all' = 'inbox'): Promise<SecureMessagesResponse> {
  return getApiClient().get(`/api/messages?folder=${folder}`);
}

/** Persist that the authenticated recipient opened a message. */
export async function markMessageRead(messageId: string): Promise<{
  success: boolean;
  message_id: string;
  read: boolean;
}> {
  return getApiClient().post(`/api/messages/${encodeURIComponent(messageId)}/read`, {});
}

/**
 * Get notifications
 */
export interface InboxNotification {
  id: string;
  type: string;
  priority: string;
  title: string;
  timestamp: number;
  patient_id?: string;
  /** `type:id`: what read and remove are addressed by. */
  key: string | null;
  /** Read by this account: shown under History rather than New. */
  read: boolean;
}

/** New (unread) and History (read), in the order the server sent them. */
export function splitInbox(notifications: InboxNotification[]): {
  fresh: InboxNotification[];
  history: InboxNotification[];
} {
  return {
    fresh: notifications.filter((entry) => !entry.read),
    history: notifications.filter((entry) => entry.read),
  };
}

export async function getNotifications(): Promise<{
  success: boolean;
  notifications: InboxNotification[];
  count: number;
  unread_count: number;
  /** Unix seconds of this caller's read marker; 0 when they never have. */
  read_at: number;
}> {
  return getApiClient().get('/api/notifications');
}

/**
 * Mark everything up to now as read.
 *
 * Individual notifications are marked with `markNotificationRead` and
 * `removeNotification`; this marks everything up to now in one go.
 */
export async function markNotificationsRead(): Promise<{
  success: boolean;
  read_at: number;
}> {
  return getApiClient().post('/api/notifications/read', {});
}

/** Mark one notification read: it moves from New to History for this account. */
export async function markNotificationRead(key: string): Promise<{ success: boolean; key: string }> {
  return getApiClient().post(`/api/notifications/${encodeURIComponent(key)}/read`, {});
}

/**
 * Take one notification off this account's screen. The record it describes and
 * its audit trail are kept, and nobody else's list changes.
 */
export async function removeNotification(key: string): Promise<{ success: boolean; key: string }> {
  return getApiClient().post(`/api/notifications/${encodeURIComponent(key)}/remove`, {});
}
