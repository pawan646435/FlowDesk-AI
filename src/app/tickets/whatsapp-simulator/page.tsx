"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  MessageSquare,
  Send,
  RefreshCw,
  User,
  Phone,
  ExternalLink,
  ShieldAlert,
  HelpCircle
} from "lucide-react";
import {
  getConversationMessages,
  getConversationByPhone,
  resetConversation
} from "../whatsapp-actions";

interface Message {
  id: string;
  sender: "CUSTOMER" | "AI" | "SYSTEM" | "AGENT";
  text: string;
  createdAt: Date;
}

interface ConversationMetadata {
  id: string;
  phoneNumber: string;
  customerName: string | null;
  status: "ACTIVE" | "ESCALATED" | "RESOLVED";
  ticketId: string | null;
}

export default function WhatsAppSimulator() {
  const { data: session } = useSession();
  const organizationId = session?.user?.organizationId ?? null;
  const [phoneNumber, setPhoneNumber] = useState("+15550199");
  const [customerName, setCustomerName] = useState("Jane Doe");
  const [messageText, setMessageText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation on mount / phone number change
  const loadConversation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const conv = await getConversationByPhone(phoneNumber);
      if (conv) {
        setConversation({
          id: conv.id,
          phoneNumber: conv.phoneNumber,
          customerName: conv.customerName,
          status: conv.status as "ACTIVE" | "ESCALATED" | "RESOLVED",
          ticketId: conv.ticketId
        });
        const msgList = await getConversationMessages(phoneNumber);
        setMessages(msgList.map(m => ({
          id: m.id,
          sender: m.sender as Message["sender"],
          text: m.text,
          createdAt: new Date(m.createdAt)
        })));
      } else {
        setConversation(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation history.");
    } finally {
      setLoading(false);
    }
  }, [phoneNumber]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim() || sending) return;

    // The webhook route requires organizationId for simulator requests (it can't resolve
    // one from a phone_number_id the way a real Meta webhook does) — without a loaded
    // session there's nothing valid to send.
    if (!organizationId) {
      setError("Your session hasn't loaded yet (or has no organization). Try again in a moment.");
      return;
    }

    setSending(true);
    setError(null);

    const textToSend = messageText;
    setMessageText("");

    // Optimistic customer message add
    const tempCustomerMsg: Message = {
      id: "temp-" + Date.now(),
      sender: "CUSTOMER",
      text: textToSend,
      createdAt: new Date()
    };
    setMessages(prev => [...prev, tempCustomerMsg]);

    try {
      const response = await fetch("/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phoneNumber,
          customerName,
          text: textToSend,
          organizationId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const result = await response.json();
      if (result.success && result.reply) {
        // Optimistic AI message add
        const tempAiMsg: Message = {
          id: "temp-ai-" + Date.now(),
          sender: "AI",
          text: result.reply,
          createdAt: new Date()
        };
        setMessages(prev => [...prev, tempAiMsg]);
      }
      
      // Reload actual database states
      await loadConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deliver message.");
      // Rollback optimistic message if error
      setMessages(prev => prev.filter(m => m.id !== tempCustomerMsg.id));
    } finally {
      setSending(false);
    }
  };

  const handleReset = async () => {
    if (confirm("Are you sure you want to reset this WhatsApp conversation history and status? This deletes messages and resets session back to ACTIVE.")) {
      setLoading(true);
      try {
        await resetConversation(phoneNumber);
        await loadConversation();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reset session.");
      } finally {
        setLoading(false);
      }
    }
  };

  const selectSuggestion = (text: string) => {
    setMessageText(text);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          WhatsApp Support Channel Simulator
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Simulate standard customer WhatsApp interactions with the stateful Gemini Support Agent. 
          Verify webhook handlers, ticket routing, sentiment triggers, and event updates locally.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Control Panel: Col 4 */}
        <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="border-b border-zinc-800 pb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Phone className="w-5 h-5 text-emerald-400" />
              Conversation Settings
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Simulated Customer Phone Number
              </label>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-4 w-4 text-zinc-500" />
                </div>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                  placeholder="+15550100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Simulated Customer Name
              </label>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-zinc-500" />
                </div>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                  placeholder="John Doe"
                />
              </div>
            </div>
          </div>

          {/* Active Conversation Metadata */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Database Session State
            </h3>

            {loading ? (
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                Querying session state...
              </div>
            ) : conversation ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Status</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                    conversation.status === "ACTIVE" 
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : conversation.status === "ESCALATED"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {conversation.status}
                  </span>
                </div>

                {conversation.ticketId && (
                  <div className="flex items-center justify-between text-sm border-t border-zinc-900 pt-3">
                    <span className="text-zinc-400">Generated Ticket</span>
                    <Link
                      href={`/tickets/${conversation.ticketId}`}
                      target="_blank"
                      className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 inline-flex hover:underline transition-colors"
                    >
                      #{conversation.ticketId.slice(0, 8)}...
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-zinc-500 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-zinc-500" />
                No session stored. Send a message to register.
              </div>
            )}
          </div>

          {/* Actions & Resets */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={loadConversation}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors border border-zinc-700"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Sync Status
            </button>
            
            <button
              onClick={handleReset}
              disabled={loading || !conversation}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/20 text-rose-400 disabled:opacity-40 rounded-lg font-semibold text-sm transition-colors"
            >
              Reset Session
            </button>
          </div>

          {/* Suggestion Prompts */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Quick Test Scenarios
            </h3>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={() => selectSuggestion("Hi, is FlowDesk AI v2 active?")}
                className="text-left text-xs bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white px-3.5 py-2.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-all"
              >
                💡 <span className="font-semibold text-zinc-100">Self-Service:</span> &quot;Hi, is FlowDesk AI v2 active?&quot;
              </button>
              
              <button
                onClick={() => selectSuggestion("My server crashed and the site is returning a 500 error. Please help immediately!")}
                className="text-left text-xs bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white px-3.5 py-2.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-all"
              >
                🔥 <span className="font-semibold text-zinc-100">Escalate Billing/Tech:</span> &quot;My server crashed...&quot;
              </button>
              
              <button
                onClick={() => selectSuggestion("I need an agent. This is urgent!")}
                className="text-left text-xs bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white px-3.5 py-2.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-all"
              >
                🚨 <span className="font-semibold text-zinc-100">Force Escalation:</span> &quot;I need an agent. This is urgent!&quot;
              </button>
            </div>
          </div>
        </div>

        {/* Right Phone Mockup: Col 7 */}
        <div className="lg:col-span-7 flex justify-center">
          <div className="w-full max-w-[420px] aspect-[9/18] min-h-[580px] bg-zinc-950 border-[8px] border-zinc-800 rounded-[3rem] shadow-2xl relative flex flex-col overflow-hidden ring-4 ring-zinc-900">
            
            {/* Phone Speaker & Camera Notch */}
            <div className="absolute top-0 inset-x-0 h-6 bg-zinc-800 flex justify-center z-20">
              <div className="w-28 h-4 bg-zinc-950 rounded-b-xl relative flex justify-center items-center">
                <span className="w-10 h-1 bg-zinc-800 rounded-full" />
                <span className="w-2.5 h-2.5 bg-zinc-800 rounded-full absolute right-4" />
              </div>
            </div>

            {/* Simulated WhatsApp Header */}
            <div className="bg-emerald-950 border-b border-emerald-900/40 px-4 pt-8 pb-3 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-white shadow-inner relative">
                  FD
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-emerald-950 rounded-full" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-zinc-100 leading-tight">FlowDesk AI Support</h3>
                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                    {sending ? (
                      <span className="animate-pulse">Typing reply...</span>
                    ) : conversation?.status === "ESCALATED" ? (
                      <span className="text-rose-400 flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" />
                        Human On-Call Team
                      </span>
                    ) : (
                      "Gemini AI Assistant"
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Chat Conversation Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat bg-opacity-5">
              {error && (
                <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-xs px-3 py-2 rounded-lg text-center font-medium">
                  {error}
                </div>
              )}

              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-2">
                  <div className="w-12 h-12 bg-emerald-950 border border-emerald-800 rounded-full flex items-center justify-center text-emerald-400">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h4 className="text-zinc-200 font-bold text-sm">No Messages Yet</h4>
                  <p className="text-zinc-500 text-xs max-w-xs">
                    Start conversation by sending a message or selecting a Scenario suggestion.
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isCustomer = msg.sender === "CUSTOMER";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs shadow-md leading-relaxed ${
                          isCustomer
                            ? "bg-emerald-600 text-white rounded-tr-none"
                            : "bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-tl-none"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        <span className={`block text-[9px] mt-1.5 text-right ${
                          isCustomer ? "text-emerald-200" : "text-zinc-500"
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

            {/* Message Input Footer */}
            <form
              onSubmit={handleSend}
              className="p-3 bg-zinc-900 border-t border-zinc-800/80 flex items-center gap-2 shrink-0 pb-6"
            >
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                disabled={sending}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-full text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-xs disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!messageText.trim() || sending || !organizationId}
                className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white flex items-center justify-center shrink-0 shadow-md transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
