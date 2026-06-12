"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  MessageSquare, 
  Send, 
  RefreshCw, 
  Search, 
  Phone, 
  ExternalLink, 
  ShieldAlert, 
  CheckCircle2, 
  Clock,
  User,
  Trash2,
  Inbox
} from "lucide-react";
import { 
  getConversations, 
  getConversationMessages, 
  resolveConversationAction, 
  resetConversation,
  sendManualAgentReply 
} from "../whatsapp-actions";

interface Message {
  id: string;
  sender: "CUSTOMER" | "AI" | "SYSTEM" | "AGENT";
  text: string;
  createdAt: Date;
}

interface Conversation {
  id: string;
  phoneNumber: string;
  customerName: string | null;
  status: "ACTIVE" | "ESCALATED" | "RESOLVED";
  createdAt: Date;
  updatedAt: Date;
  ticketId: string | null;
  messages: { text: string; createdAt: Date }[];
  ticket?: {
    id: string;
    status: string;
    priority: string | null;
  } | null;
}

export default function WhatsAppHistoryPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation list
  const loadConversations = async (autoSelectFirst = false) => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await getConversations();
      const formatted: Conversation[] = list.map(c => ({
        id: c.id,
        phoneNumber: c.phoneNumber,
        customerName: c.customerName,
        status: c.status as any,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        ticketId: c.ticketId,
        messages: c.messages.map(m => ({
          text: m.text,
          createdAt: new Date(m.createdAt)
        })),
        ticket: c.ticket
      }));
      setConversations(formatted);

      if (autoSelectFirst && formatted.length > 0 && !selectedPhone) {
        setSelectedPhone(formatted[0].phoneNumber);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load conversations.");
    } finally {
      setLoadingList(false);
    }
  };

  // Load message logs for active conversation
  const loadMessages = async (phone: string) => {
    setLoadingMessages(true);
    try {
      const msgList = await getConversationMessages(phone);
      setMessages(msgList.map(m => ({
        id: m.id,
        sender: m.sender as any,
        text: m.text,
        createdAt: new Date(m.createdAt)
      })));
    } catch (err: any) {
      setError(err.message || "Failed to load messages.");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadConversations(true);
  }, []);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages(selectedPhone);
    } else {
      setMessages([]);
    }
  }, [selectedPhone]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeConv = conversations.find(c => c.phoneNumber === selectedPhone) || null;

  // Manual agent reply submit
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedPhone || sendingReply) return;

    setSendingReply(true);
    const textToSend = replyText;
    setReplyText("");

    try {
      const res = await sendManualAgentReply(selectedPhone, textToSend);
      if (!res.success) {
        throw new Error(res.error || "Failed to deliver manual reply.");
      }
      
      // Reload messages & update conversation snippet
      await loadMessages(selectedPhone);
      await loadConversations();
    } catch (err: any) {
      setError(err.message || "Failed to send message.");
    } finally {
      setSendingReply(false);
    }
  };

  // Mark session & ticket resolved
  const handleResolve = async () => {
    if (!selectedPhone || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await resolveConversationAction(selectedPhone);
      if (!res.success) {
        throw new Error(res.error);
      }
      await loadConversations();
    } catch (err: any) {
      setError(err.message || "Failed to resolve conversation.");
    } finally {
      setActionLoading(false);
    }
  };

  // Reset conversation (clear messages)
  const handleReset = async () => {
    if (!selectedPhone || actionLoading) return;
    if (confirm("Are you sure you want to clear conversation logs and reset state back to ACTIVE?")) {
      setActionLoading(true);
      try {
        const res = await resetConversation(selectedPhone);
        if (!res.success) {
          throw new Error(res.error);
        }
        await loadMessages(selectedPhone);
        await loadConversations();
      } catch (err: any) {
        setError(err.message || "Failed to reset session.");
      } finally {
        setActionLoading(false);
      }
    }
  };

  // Filter conversations based on search query
  const filteredConversations = conversations.filter(c => {
    const term = searchQuery.toLowerCase();
    return (
      c.phoneNumber.toLowerCase().includes(term) ||
      (c.customerName && c.customerName.toLowerCase().includes(term)) ||
      (c.messages[0]?.text && c.messages[0].text.toLowerCase().includes(term))
    );
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Inbox className="w-8 h-8 text-emerald-400" />
            WhatsApp Customer Inbox
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Monitor stateful WhatsApp conversations, inspect automated ticket creations, and reply to customers in real-time.
          </p>
        </div>
        <button
          onClick={() => loadConversations()}
          disabled={loadingList}
          className="inline-flex items-center justify-center px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white rounded-lg font-semibold text-sm transition-colors shrink-0"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loadingList ? "animate-spin text-emerald-400" : ""}`} />
          Refresh Inbox
        </button>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-sm px-4 py-3 rounded-lg font-medium flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          <span>{error}</span>
          <button className="ml-auto text-rose-400 hover:text-rose-300 font-bold" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Main Inbox Interface */}
      <div className="grid grid-cols-1 md:grid-cols-12 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl min-h-[640px] aspect-[16/9]">
        
        {/* Left Side: Conversation List (Col 4) */}
        <div className="md:col-span-4 border-r border-zinc-800 flex flex-col h-full bg-zinc-950/50">
          <div className="p-4 border-b border-zinc-800/80 space-y-3">
            <div className="relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-zinc-500" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search phone or content..."
                className="block w-full pl-10 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-zinc-850">
            {filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 h-64">
                <MessageSquare className="w-8 h-8 mb-2 text-zinc-600" />
                <p className="text-sm">No conversations found</p>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isActive = conv.phoneNumber === selectedPhone;
                const latestMsg = conv.messages[0]?.text || "(No messages)";
                const timeString = conv.messages[0]?.createdAt 
                  ? new Date(conv.messages[0].createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) 
                  : "";

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedPhone(conv.phoneNumber)}
                    className={`w-full text-left p-4 flex gap-3 items-start transition-colors ${
                      isActive ? "bg-zinc-800/60" : "hover:bg-zinc-900/40"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center font-bold text-zinc-300 uppercase shrink-0">
                      {conv.customerName ? conv.customerName.slice(0, 2) : "WA"}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <h4 className="font-bold text-xs text-white truncate max-w-[70%]">
                          {conv.customerName || conv.phoneNumber}
                        </h4>
                        <span className="text-[10px] text-zinc-500 font-medium whitespace-nowrap">
                          {timeString}
                        </span>
                      </div>
                      
                      <p className="text-xs text-zinc-400 truncate pr-2 mb-2">
                        {latestMsg}
                      </p>

                      <div className="flex gap-2 items-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          conv.status === "ACTIVE" 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/10"
                            : conv.status === "ESCALATED"
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/10"
                            : "bg-blue-500/10 text-blue-400 border-blue-500/10"
                        }`}>
                          {conv.status}
                        </span>

                        {conv.phoneNumber && (
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {conv.phoneNumber}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Message log & Timeline (Col 8) */}
        <div className="md:col-span-8 flex flex-col h-full bg-zinc-950/20">
          {activeConv ? (
            <>
              {/* Active Conversation Header */}
              <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-950 border border-emerald-800/60 flex items-center justify-center font-bold text-emerald-400">
                    {activeConv.customerName ? activeConv.customerName.slice(0, 2).toUpperCase() : "WA"}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">
                      {activeConv.customerName || "WhatsApp User"}
                    </h3>
                    <p className="text-xs text-zinc-400 font-mono">{activeConv.phoneNumber}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  {activeConv.ticketId && (
                    <Link
                      href={`/tickets/${activeConv.ticketId}`}
                      className="inline-flex items-center justify-center px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-emerald-400 font-semibold rounded-lg border border-zinc-700 transition-colors"
                    >
                      Ticket #{activeConv.ticketId.slice(0, 8)}...
                      <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                    </Link>
                  )}

                  {activeConv.status === "ESCALATED" && (
                    <button
                      onClick={handleResolve}
                      disabled={actionLoading}
                      className="inline-flex items-center justify-center px-3 py-1.5 bg-emerald-600/15 border border-emerald-500/20 hover:bg-emerald-600/25 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                      Resolve Session
                    </button>
                  )}

                  <button
                    onClick={handleReset}
                    disabled={actionLoading}
                    title="Reset Session"
                    className="inline-flex items-center justify-center p-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-zinc-800 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Chat Message Scroll Log */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat bg-opacity-5">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2 text-emerald-400" />
                    Loading message audit trail...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 text-xs">
                    No message history available for this session.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isCustomer = msg.sender === "CUSTOMER";
                    let senderLabel = "Customer";
                    if (msg.sender === "AI") senderLabel = "Gemini Support AI";
                    if (msg.sender === "AGENT") senderLabel = "Support Agent (Manual)";
                    if (msg.sender === "SYSTEM") senderLabel = "System";

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isCustomer ? "items-start" : "items-end"}`}
                      >
                        {/* Sender Tag */}
                        <span className="text-[10px] text-zinc-500 mb-1 px-1 font-medium">
                          {senderLabel}
                        </span>
                        
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-md leading-relaxed ${
                            isCustomer
                              ? "bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700/60"
                              : msg.sender === "AGENT"
                              ? "bg-blue-600 text-white rounded-tr-none"
                              : "bg-emerald-600 text-white rounded-tr-none"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                          <span className={`block text-[9px] mt-1.5 text-right ${
                            isCustomer ? "text-zinc-500" : "text-emerald-100"
                          }`}>
                            {msg.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Field (Agent manual override) */}
              <form
                onSubmit={handleSendReply}
                className="p-4 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3 shrink-0"
              >
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  disabled={sendingReply || loadingMessages}
                  placeholder={
                    activeConv.status === "ESCALATED" 
                      ? "Send a message as Support Agent..." 
                      : "Type reply (AI conversation remains active)..."
                  }
                  className="flex-1 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-full text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-xs disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sendingReply || loadingMessages}
                  className="w-11 h-11 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white flex items-center justify-center shrink-0 shadow-md transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center p-8 space-y-4">
              <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center text-zinc-400 shadow-inner">
                <MessageSquare className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-zinc-300 font-bold text-sm">No Active Conversation Selected</h4>
                <p className="text-zinc-500 text-xs mt-1 max-w-xs mx-auto">
                  Select an customer conversation from the list to audit transcripts and reply.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
