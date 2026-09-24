import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getApiErrorMessage,
  markMessageRead,
  useTranslation,
  getMessages,
  sendMessage,
  formatDateOnly,
  formatTimestamp,
} from '@medichain/shared';
import type { MessageConversation, SecureMessagesResponse, SecureMessage } from '@medichain/shared';
import { Loader2, MessageSquare, RefreshCw, Send, User } from 'lucide-react';
import StaffSelect from '../components/StaffSelect';
import { useAuthStore } from '../store/authStore';

interface SendForm {
  recipient_id: string;
  subject: string;
  body: string;
}

const EMPTY_FORM: SendForm = { recipient_id: '', subject: '', body: '' };

function messageDate(sentAt: number): string {
  return formatTimestamp(sentAt * 1000);
}

function conversationDate(sentAt: number | null): string {
  return sentAt ? formatDateOnly(sentAt * 1000) : '';
}

function participantLabel(conversation: MessageConversation): string {
  return conversation.providerName?.trim() || 'Unknown participant';
}

export default function MessagesPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [conversations, setConversations] = useState<MessageConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [sendForm, setSendForm] = useState<SendForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedConversation = useMemo(
    () => conversations.find(conversation => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const fetchConversations = useCallback(async (): Promise<MessageConversation[]> => {
    if (!user) return [];
    setLoading(true);
    setError('');
    try {
      let data: SecureMessagesResponse;
      try {
        data = await getMessages('all');
      } catch (refused) {
        setError(getApiErrorMessage(refused, t('docMessages.failLoad')));
        return [];
      }
      const loaded = Array.isArray(data.conversations) ? data.conversations : [];
      setConversations(loaded);
      return loaded;
    } catch (loadError) {
      console.error(loadError);
      setError(t('docMessages.cannotConnect'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const selectConversation = (conversation: MessageConversation) => {
    setShowCompose(false);
    setSelectedId(conversation.id);
    setSendForm({ recipient_id: conversation.providerId, subject: '', body: '' });
  };

  useEffect(() => {
    if (!selectedConversation || selectedConversation.unreadCount === 0 || !user) return;
    const unread = selectedConversation.messages.filter(
      message => !message.read && message.recipient_id === user.walletAddress,
    );
    if (unread.length === 0) return;
    const selectedConversationId = selectedConversation.id;
    const persistReadState = async () => {
      try {
        await Promise.all(unread.map(message => markMessageRead(message.message_id)));
        setConversations(current => current.map(candidate =>
          candidate.id === selectedConversationId
            ? {
                ...candidate,
                unreadCount: 0,
                messages: candidate.messages.map(message => ({
                  ...message,
                  read: message.recipient_id === user.walletAddress ? true : message.read,
                })),
              }
            : candidate
        ));
        window.dispatchEvent(new Event('medichain:sidebar-refresh'));
      } catch (readError) {
        console.error(readError);
        setError(t('docMessages.failLoad'));
      }
    };
    void persistReadState();
  }, [selectedConversation, t, user]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const recipientId = selectedConversation?.providerId || sendForm.recipient_id;
    if (!recipientId || !sendForm.body.trim()) return;
    setSendLoading(true);
    setError('');
    setSuccess('');
    try {
      const selectedMessages = selectedConversation?.messages ?? [];
      const latest = selectedMessages[selectedMessages.length - 1];
      const payload: Record<string, string> = {
        recipient_id: recipientId,
        content: sendForm.body.trim(),
      };
      if (sendForm.subject.trim()) payload.subject = sendForm.subject.trim();
      if (latest?.thread_id) payload.thread_id = latest.thread_id;
      if (latest?.message_id) payload.reply_to = latest.message_id;
      try {
        await sendMessage(payload as Parameters<typeof sendMessage>[0]);
      } catch (refused) {
        setError(getApiErrorMessage(refused, t('docMessages.failSend')));
        return;
      }
      setSuccess(t('docMessages.sentVisible'));
      setSendForm({ recipient_id: recipientId, subject: '', body: '' });
      setShowCompose(false);
      const loaded = await fetchConversations();
      if (loaded.some(conversation => conversation.id === recipientId)) {
        setSelectedId(recipientId);
      }
      window.dispatchEvent(new Event('medichain:sidebar-refresh'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (sendError) {
      console.error(sendError);
      setError(t('docMessages.failSend'));
    } finally {
      setSendLoading(false);
    }
  };

  const unreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  const beginCompose = () => {
    setShowCompose(true);
    setSelectedId(null);
    setSendForm(EMPTY_FORM);
    setError('');
    setSuccess('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <MessageSquare className="text-notice-subtle-fg" size={24} />
            {t('docMessages.title')}
            {unreadCount > 0 && (
              <span className="bg-critical text-critical-fg text-xs px-2 py-0.5 rounded-full ml-1">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-content-muted text-sm mt-1">{t('docMessages.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void fetchConversations()}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-surface-sunken text-sm"
          >
            <RefreshCw size={14} /> {t('docMessages.refresh')}
          </button>
          <button
            onClick={beginCompose}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
          >
            <Send size={14} /> {t('docMessages.compose')}
          </button>
        </div>
      </header>

      {success && (
        <div role="status" className="mb-4 p-3 bg-ok-subtle border border-ok text-ok-subtle-fg rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 p-3 bg-critical-subtle border border-critical text-critical-subtle-fg rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,0.9fr)_minmax(420px,1.6fr)] gap-6">
        <section className="bg-surface rounded-xl shadow min-h-[520px]" aria-label={t('docMessages.conversations')}>
          <div className="p-4 border-b">
            <h2 className="font-semibold text-content">{t('docMessages.conversations')}</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto animate-spin text-notice-subtle-fg mb-2" size={32} />
              <p className="text-content-muted">{t('docMessages.loading')}</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-content-muted">
              <MessageSquare className="mx-auto mb-2 text-content-muted" size={40} />
              <p>{t('docMessages.noConversations')}</p>
            </div>
          ) : (
            <div className="divide-y">
              {conversations.map(conversation => (
                <button
                  key={conversation.id}
                  onClick={() => selectConversation(conversation)}
                  className={`w-full text-left p-4 hover:bg-surface-sunken transition-colors ${selectedId === conversation.id ? 'bg-notice-subtle' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-2 min-w-0">
                      <User size={16} className="mt-0.5 shrink-0 text-content-muted" />
                      <div className="min-w-0">
                        <p className="font-semibold text-content truncate">{participantLabel(conversation)}</p>
                        <p className="text-xs text-content-muted truncate">
                          {conversation.specialty || conversation.providerRole || t('docMessages.participant')}
                        </p>
                        <p className="text-sm text-content-muted truncate mt-1">{conversation.lastMessage}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs text-content-muted">{conversationDate(conversation.lastMessageTime)}</span>
                      {conversation.unreadCount > 0 && (
                        <span className="inline-flex mt-2 min-w-5 h-5 items-center justify-center rounded-full bg-critical text-critical-fg text-xs px-1">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="bg-surface rounded-xl shadow min-h-[520px] flex flex-col" aria-label={t('docMessages.history')}>
          {showCompose ? (
            <ComposeForm
              form={sendForm}
              loading={sendLoading}
              onChange={setSendForm}
              onCancel={() => setShowCompose(false)}
              onSubmit={handleSend}
              title={t('docMessages.newMessage')}
            />
          ) : selectedConversation ? (
            <>
              <div className="p-4 border-b">
                <h2 className="font-semibold text-content">{participantLabel(selectedConversation)}</h2>
                <p className="text-xs text-content-muted">
                  {selectedConversation.specialty || selectedConversation.providerRole || t('docMessages.participant')}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-sunken max-h-[520px]">
                {selectedConversation.messages.map(message => (
                  <MessageBubble key={message.message_id} message={message} currentUserId={user?.walletAddress ?? ''} />
                ))}
              </div>
              <form onSubmit={handleSend} className="border-t p-4 space-y-3">
                <label htmlFor="thread-message" className="block text-sm font-medium text-content-secondary">
                  {t('docMessages.replyTo', { name: participantLabel(selectedConversation) })}
                </label>
                <textarea
                  id="thread-message"
                  value={sendForm.body}
                  onChange={event => setSendForm({ ...sendForm, body: event.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  required
                  placeholder={t('docMessages.messagePlaceholder')}
                />
                <button
                  type="submit"
                  disabled={sendLoading || !sendForm.body.trim()}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
                >
                  {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t('docMessages.send')}
                </button>
              </form>
            </>
          ) : (
            <div className="m-auto p-8 text-center text-content-muted">
              <MessageSquare size={40} className="mx-auto mb-2 text-content-muted" />
              <p className="text-sm">{t('docMessages.selectConversation')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageBubble({ message, currentUserId }: { message: SecureMessage; currentUserId: string }) {
  const mine = message.sender_id === currentUserId;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[82%]">
        <div className={`rounded-2xl px-4 py-3 ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-surface text-content rounded-bl-md shadow-sm'}`}>
          {message.subject && <p className="text-xs font-semibold mb-1 opacity-80">{message.subject}</p>}
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <p className={`mt-1 text-xs text-content-muted ${mine ? 'text-right' : 'text-left'}`}>
          {mine ? 'You' : message.sender_name} · {messageDate(message.sent_at)}
          {mine && message.read ? ' · Read' : ''}
        </p>
      </div>
    </div>
  );
}

function ComposeForm({
  form,
  loading,
  onChange,
  onCancel,
  onSubmit,
  title,
}: {
  form: SendForm;
  loading: boolean;
  onChange: (form: SendForm) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="p-4">
      <h2 className="font-semibold text-content mb-4">{title}</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <StaffSelect
          id="msg-recipient"
          value={form.recipient_id}
          onChange={recipientId => onChange({ ...form, recipient_id: recipientId })}
          label={t('docMessages.toProvider')}
          placeholder={t('docMessages.providerPlaceholder')}
          required
        />
        <div>
          <label htmlFor="msg-subject" className="block text-xs font-medium text-content-secondary mb-1">{t('docMessages.subject')}</label>
          <input
            id="msg-subject"
            value={form.subject}
            onChange={event => onChange({ ...form, subject: event.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder={t('docMessages.subjectPlaceholder')}
          />
        </div>
        <div>
          <label htmlFor="msg-body" className="block text-xs font-medium text-content-secondary mb-1">{t('docMessages.message')}</label>
          <textarea
            id="msg-body"
            value={form.body}
            onChange={event => onChange({ ...form, body: event.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            rows={8}
            required
            placeholder={t('docMessages.messagePlaceholder')}
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={loading || !form.recipient_id || !form.body.trim()} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {t('docMessages.send')}
          </button>
          <button type="button" onClick={onCancel} className="px-3 py-2 border rounded text-sm hover:bg-surface-sunken">
            {t('docMessages.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
