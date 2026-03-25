import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiUrl } from '@medichain/shared';
import { MessageSquare, Send, Loader2, RefreshCw, User } from 'lucide-react';

interface Message {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  subject?: string;
  body: string;
  sent_at: number;
  read: boolean;
  thread_id?: string;
}

export default function MessagesPage() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showReply, setShowReply] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [sendForm, setSendForm] = useState({
    recipient_id: '',
    subject: '',
    body: '',
  });

  useEffect(() => {
    fetchMessages();
  }, [user]);

  const fetchMessages = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/messages'), {
        headers: {
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || data || []);
      } else {
        setError('Failed to load messages');
      }
    } catch (e) {
      console.error(e);
      setError('Unable to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSendLoading(true);
    setError('');
    try {
      const payload: Record<string, string> = {
        recipient_id: sendForm.recipient_id,
        body: sendForm.body,
      };
      if (sendForm.subject) payload.subject = sendForm.subject;
      if (selectedMessage?.thread_id) payload.thread_id = selectedMessage.thread_id;
      if (selectedMessage?.message_id) payload.reply_to = selectedMessage.message_id;

      const res = await fetch(apiUrl('/api/messages/send'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSuccess('Message sent!');
        setSendForm({ recipient_id: '', subject: '', body: '' });
        setShowReply(false);
        setSelectedMessage(null);
        fetchMessages();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send message');
      }
    } catch (e) {
      setError('Failed to send message');
    } finally {
      setSendLoading(false);
    }
  };

  const unreadCount = messages.filter(m => !m.read).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="text-blue-500" size={24} />
            Messages
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full ml-1">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Secure provider messaging</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchMessages}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => { setShowReply(true); setSelectedMessage(null); setSendForm({ recipient_id: '', subject: '', body: '' }); }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
          >
            <Send size={14} />
            Compose
          </button>
        </div>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inbox */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900">Inbox</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto animate-spin text-blue-500 mb-2" size={32} />
              <p className="text-gray-500">Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MessageSquare className="mx-auto mb-2 text-gray-300" size={40} />
              <p>No messages</p>
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((msg) => (
                <button
                  key={msg.message_id}
                  onClick={() => { setSelectedMessage(msg); setShowReply(false); }}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${selectedMessage?.message_id === msg.message_id ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {!msg.read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1"></span>
                      )}
                      <div className="min-w-0">
                        <p className={`font-medium text-gray-900 truncate ${!msg.read ? 'font-semibold' : ''}`}>
                          {msg.subject || 'No subject'}
                        </p>
                        <p className="text-sm text-gray-500 flex items-center gap-1">
                          <User size={12} />
                          From: {msg.sender_id === user?.walletAddress ? 'You' : msg.sender_id}
                        </p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{msg.body}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                      {new Date(msg.sent_at * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message Detail / Compose */}
        <div className="bg-white rounded-xl shadow">
          {selectedMessage && !showReply ? (
            <div className="p-4">
              <div className="border-b pb-3 mb-3">
                <h3 className="font-semibold text-gray-900">{selectedMessage.subject || 'No subject'}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  From: {selectedMessage.sender_id}<br />
                  To: {selectedMessage.recipient_id}<br />
                  {new Date(selectedMessage.sent_at * 1000).toLocaleString()}
                </p>
              </div>
              <p className="text-gray-700 text-sm whitespace-pre-wrap">{selectedMessage.body}</p>
              <button
                onClick={() => {
                  setShowReply(true);
                  setSendForm({
                    recipient_id: selectedMessage.sender_id === user?.walletAddress ? selectedMessage.recipient_id : selectedMessage.sender_id,
                    subject: selectedMessage.subject ? `Re: ${selectedMessage.subject}` : 'Re:',
                    body: '',
                  });
                }}
                className="mt-4 w-full flex items-center justify-center gap-2 border rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
              >
                <Send size={14} />
                Reply
              </button>
            </div>
          ) : showReply ? (
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">
                {selectedMessage ? 'Reply' : 'New Message'}
              </h3>
              <form onSubmit={handleSend} className="space-y-3">
                <div>
                  <label htmlFor="msg-recipient" className="block text-xs font-medium text-gray-700 mb-1">To (User ID)</label>
                  <input
                    id="msg-recipient"
                    type="text"
                    value={sendForm.recipient_id}
                    onChange={e => setSendForm({ ...sendForm, recipient_id: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    required
                    placeholder="Recipient ID..."
                  />
                </div>
                <div>
                  <label htmlFor="msg-subject" className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    id="msg-subject"
                    type="text"
                    value={sendForm.subject}
                    onChange={e => setSendForm({ ...sendForm, subject: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="Subject..."
                  />
                </div>
                <div>
                  <label htmlFor="msg-body" className="block text-xs font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    id="msg-body"
                    value={sendForm.body}
                    onChange={e => setSendForm({ ...sendForm, body: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    rows={6}
                    required
                    placeholder="Type your message..."
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={sendLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowReply(false); setSendForm({ recipient_id: '', subject: '', body: '' }); }}
                    className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400">
              <MessageSquare size={40} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm">Select a message to read<br />or compose a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
