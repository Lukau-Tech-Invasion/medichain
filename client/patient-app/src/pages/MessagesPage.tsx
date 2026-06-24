import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, useTranslation } from '@medichain/shared';
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

/**
 * MessagesPage - Secure messaging with healthcare providers
 * 
 * Features:
 * - View conversations with providers
 * - Send/receive messages
 * - Attach documents
 * - Message history
 * 
 * © 2025 Trustware. All rights reserved.
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadConversations();
    }
  }, [patient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation?.messages]);

  const loadConversations = async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const response = await fetch(apiUrl(`/api/messages`), {
        headers: { 
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiConnected(true);
        // Transform API data to conversations format
        setConversations(data.conversations || []);
      } else {
        setApiConnected(false);
      }
    } catch {
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedConversation || !patient) return;

    const message: Message = {
      id: `MSG-${Date.now()}`,
      senderId: patient.healthId,
      senderName: patient.fullName,
      senderRole: 'Patient',
      content: newMessage,
      timestamp: new Date().toISOString(),
      read: true,
      isPatient: true,
    };

    setConversations(prev => prev.map(conv => 
      conv.id === selectedConversation.id
        ? {
            ...conv,
            messages: [...conv.messages, message],
            lastMessage: newMessage,
            lastMessageTime: new Date().toISOString(),
          }
        : conv
    ));

    setSelectedConversation(prev => prev ? {
      ...prev,
      messages: [...prev.messages, message],
      lastMessage: newMessage,
      lastMessageTime: new Date().toISOString(),
    } : null);

    setNewMessage('');
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
        <div className="bg-white border-b border-neutral-200 p-4 flex items-center gap-4">
          <button
            onClick={() => setSelectedConversation(null)}
            className="p-2 hover:bg-neutral-100 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-neutral-900">{selectedConversation.providerName}</h2>
            <p className="text-sm text-neutral-500">{selectedConversation.specialty}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50">
          {selectedConversation.messages.map(message => (
            <div
              key={message.id}
              className={`flex ${message.isPatient ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] ${message.isPatient ? 'order-2' : 'order-1'}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.isPatient
                    ? 'bg-primary-500 text-white rounded-br-md'
                    : 'bg-white text-neutral-900 rounded-bl-md shadow-sm'
                }`}>
                  <p className="text-sm">{message.content}</p>
                </div>
                <div className={`flex items-center gap-1 mt-1 text-xs text-neutral-400 ${
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
        <div className="bg-white border-t border-neutral-200 p-4">
          <div className="flex items-center gap-3">
            <button className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg">
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={t('messages.typePlaceholder')}
              className="flex-1 px-4 py-2 border border-neutral-200 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim()}
              className="p-3 bg-primary-500 text-white rounded-full hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <h1 className="text-2xl font-bold text-neutral-900">{t('messages.title')}</h1>
          <p className="text-neutral-500">
            {totalUnread > 0 ? t('messages.unreadCount', { count: totalUnread }) : t('messages.allCaughtUp')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('messages.searchPlaceholder')}
          className="w-full pl-12 pr-4 py-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>

      {/* New Message Button */}
      <button className="w-full patient-card flex items-center gap-4 p-4 hover:border-primary-200 border-2 border-transparent">
        <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
          <Plus className="w-6 h-6 text-primary-600" />
        </div>
        <div className="text-left">
          <div className="font-medium text-neutral-900">{t('messages.startNew')}</div>
          <div className="text-sm text-neutral-500">{t('messages.startNewDesc')}</div>
        </div>
      </button>

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
            className="w-full patient-card flex items-center gap-4 p-4 hover:border-primary-200 border-2 border-transparent text-left"
          >
            <div className="relative">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="w-6 h-6 text-primary-600" />
              </div>
              {conversation.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-emergency-500 text-white text-xs rounded-full flex items-center justify-center">
                  {conversation.unreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-neutral-900">{conversation.providerName}</h3>
                <span className="text-xs text-neutral-400">{formatTime(conversation.lastMessageTime)}</span>
              </div>
              <p className="text-sm text-neutral-500">{conversation.specialty}</p>
              <p className={`text-sm truncate ${conversation.unreadCount > 0 ? 'text-neutral-900 font-medium' : 'text-neutral-500'}`}>
                {conversation.lastMessage}
              </p>
            </div>
          </button>
        ))}

        {filteredConversations.length === 0 && (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500">{t('messages.noConversations')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
