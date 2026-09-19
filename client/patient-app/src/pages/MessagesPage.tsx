import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMessages, getProviders, sendMessage as sendSecureMessage, useTranslation } from '@medichain/shared';
import type { BookableProvider, MessageConversation, SecureMessage } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  MessageCircle,
  Send,
  User,
  Search,
  Paperclip,
  ChevronLeft,
  Clock,
  CheckCheck,
  Loader2,
  Wifi,
  WifiOff,
  Plus,
} from 'lucide-react';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  timestamp: string;
  read: boolean;
  isPatient: boolean;
}

interface Conversation {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  specialty: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: Message[];
}

function messageTimestamp(value: number | string): string {
  return typeof value === 'number'
    ? new Date(value * 1000).toISOString()
    : value;
}

/**
 * Convert the persisted API contract into presentation state. Timestamps are
 * Unix seconds on the wire and must not be handed to `Date` as milliseconds.
 */
function normalizeConversation(raw: MessageConversation, patientWallet: string): Conversation {
  return {
    id: raw.id,
    providerId: raw.providerId,
    providerName: raw.providerName,
    providerRole: raw.providerRole || 'Provider',
    specialty: raw.specialty || raw.providerRole || 'Healthcare provider',
    lastMessage: raw.lastMessage || '',
    lastMessageTime: messageTimestamp(raw.lastMessageTime ?? ''),
    unreadCount: raw.unreadCount,
    messages: raw.messages.map((message: SecureMessage) => ({
      id: message.message_id,
      senderId: message.sender_id,
      senderName: message.sender_name,
      senderRole: message.sender_role,
      content: message.content,
      timestamp: messageTimestamp(message.sent_at),
      read: Boolean(message.read),
      isPatient: message.sender_id === patientWallet,
    })),
  };
}

/**
 * MessagesPage - Secure messaging with healthcare providers
 * 
 * Features:
 * - View conversations with providers
 * - Send/receive messages
 * - Attach documents
 * - Message history
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MessagesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providers, setProviders] = useState<BookableProvider[]>([]);
  const [showProviders, setShowProviders] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  const loadConversations = useCallback(async () => {
    if (!patient) return [];
    
    setLoading(true);
    try {
      const data = await getMessages('all');
      setApiConnected(true);
      const loaded = data.conversations.map(
        (conversation) => normalizeConversation(conversation, patient.walletAddress)
      );
      setConversations(loaded);
      return loaded;
    } catch {
      setApiConnected(false);
      return [];
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => {
    if (patient) {
      loadConversations();
    }
  }, [patient, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation?.messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || !patient) return;

    setSendError(null);
    const content = newMessage.trim();
    try {
      await sendSecureMessage({
        recipient_id: selectedConversation.providerId,
        subject: 'Patient message',
        content,
        related_patient_id: patient.healthId,
      });
      setNewMessage('');
      const loaded = await loadConversations();
      setSelectedConversation(
        loaded.find((conversation) => conversation.providerId === selectedConversation.providerId) ?? null
      );
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The message could not be sent.');
    }
  };

  const startConversation = async () => {
    if (!patient) return;
    try {
      const data = await getProviders();
      setProviders(data.providers);
      setShowProviders(true);
    } catch {
      setSendError('The provider directory could not be loaded.');
    }
  };

  const selectProvider = (provider: BookableProvider) => {
    setSelectedConversation({
      id: provider.wallet_address,
      providerId: provider.wallet_address,
      providerName: provider.name,
      providerRole: provider.role,
      specialty: provider.specialty || provider.role,
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0,
      messages: [],
    });
    setShowProviders(false);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const filteredConversations = conversations.filter(c =>
    c.providerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.specialty.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  // Conversation Detail View
  if (selectedConversation) {
    return (
      <div className="flex flex-col h-[calc(100vh-80px)]">
        {/* Header */}
        <div className="bg-surface border-b border-border p-4 flex items-center gap-4">
          <button
            onClick={() => setSelectedConversation(null)}
            className="p-2 hover:bg-surface-sunken rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 bg-brand-subtle rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h2 className="font-semibold text-content">{selectedConversation.providerName}</h2>
            <p className="text-sm text-content-muted">{selectedConversation.specialty}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-sunken">
          {selectedConversation.messages.map(message => (
            <div
              key={message.id}
              className={`flex ${message.isPatient ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] ${message.isPatient ? 'order-2' : 'order-1'}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.isPatient
                    ? 'bg-primary-500 text-brand-fg rounded-br-md'
                    : 'bg-surface text-content rounded-bl-md shadow-sm'
                }`}>
                  <p className="text-sm">{message.content}</p>
                </div>
                <div className={`flex items-center gap-1 mt-1 text-xs text-content-muted ${
                  message.isPatient ? 'justify-end' : 'justify-start'
                }`}>
                  <Clock className="w-3 h-3" />
                  {formatTime(message.timestamp)}
                  {message.isPatient && message.read && (
                    <CheckCheck className="w-3 h-3 text-primary-400" />
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bg-surface border-t border-border p-4">
          {sendError && <p role="alert" className="mb-2 text-sm text-critical-subtle-fg">{sendError}</p>}
          <div className="flex items-center gap-3">
            <button className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg" aria-label="Attach file">
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void sendMessage()}
              placeholder={t('messages.typePlaceholder')}
              className="flex-1 px-4 py-2 border border-border-interactive rounded-full focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!newMessage.trim()}
              className="p-3 bg-primary-500 text-brand-fg rounded-full hover:bg-brand disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Conversations List View
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('messages.title')}</h1>
          <p className="text-content-muted">
            {totalUnread > 0 ? t('messages.unreadCount', { count: totalUnread }) : t('messages.allCaughtUp')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.dataUnavailable')}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('messages.searchPlaceholder')}
          className="w-full pl-12 pr-4 py-3 border border-border-interactive rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
        />
      </div>

      {/* New Message Button */}
      <button onClick={() => void startConversation()} className="w-full patient-card flex items-center gap-4 p-4 hover:border-brand border-2 border-transparent">
        <div className="w-12 h-12 bg-brand-subtle rounded-full flex items-center justify-center">
          <Plus className="w-6 h-6 text-brand" />
        </div>
        <div className="text-left">
          <div className="font-medium text-content">{t('messages.startNew')}</div>
          <div className="text-sm text-content-muted">{t('messages.startNewDesc')}</div>
        </div>
      </button>

      {sendError && <p role="alert" className="text-sm text-critical-subtle-fg">{sendError}</p>}
      {showProviders && (
        <div className="patient-card space-y-2" aria-label="Provider directory">
          <h2 className="font-semibold text-content">Choose a provider</h2>
          {providers.map(provider => (
            <button
              key={provider.wallet_address}
              onClick={() => selectProvider(provider)}
              className="w-full rounded-lg border border-border p-3 text-left hover:border-brand"
            >
              <span className="block font-medium">{provider.name}</span>
              <span className="text-sm text-content-muted">{provider.specialty || provider.role}</span>
            </button>
          ))}
        </div>
      )}

      {/* Conversations */}
      <div className="space-y-3">
        {filteredConversations.map(conversation => (
          <button
            key={conversation.id}
            onClick={() => {
              setSelectedConversation(conversation);
              // Mark as read
              setConversations(prev => prev.map(c =>
                c.id === conversation.id ? { ...c, unreadCount: 0 } : c
              ));
            }}
            className="w-full patient-card flex items-center gap-4 p-4 hover:border-brand border-2 border-transparent text-left"
          >
            <div className="relative">
              <div className="w-12 h-12 bg-brand-subtle rounded-full flex items-center justify-center">
                <User className="w-6 h-6 text-brand" />
              </div>
              {conversation.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-critical text-critical-fg text-xs rounded-full flex items-center justify-center">
                  {conversation.unreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-content">{conversation.providerName}</h3>
                <span className="text-xs text-content-muted">{formatTime(conversation.lastMessageTime)}</span>
              </div>
              <p className="text-sm text-content-muted">{conversation.specialty}</p>
              <p className={`text-sm truncate ${conversation.unreadCount > 0 ? 'text-content font-medium' : 'text-content-muted'}`}>
                {conversation.lastMessage}
              </p>
            </div>
          </button>
        ))}

        {filteredConversations.length === 0 && (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-content-muted">{t('messages.noConversations')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
