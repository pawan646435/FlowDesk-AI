"use client";

import React, { useState, useEffect } from "react";
import {
  FileText,
  UploadCloud,
  Trash2,
  Search,
  AlertCircle,
  RefreshCw,
  Database,
  SearchCode
} from "lucide-react";
import type { SimilaritySearchResult } from "@/services/rag.service";

interface DocItem {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  status: string;
  createdAt: string;
}

interface StatsData {
  totalDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  retrievalRequests: number;
  successfulRetrievals: number;
  fallbackResponses: number;
  averageSimilarityScore: number;
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadError, setUploadError] = useState("");

  // Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SimilaritySearchResult[]>([]);

  // Fetch documents and stats
  const fetchData = async () => {
    try {
      const response = await fetch("/api/knowledge-base");
      const data = await response.json();
      if (data.success) {
        setDocuments(data.documents);
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load knowledge base data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadFile(file);
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
      setUploadError("");
    }
  };

  // Handle upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError("Please select a file to upload.");
      return;
    }

    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("title", uploadTitle);

    try {
      const response = await fetch("/api/knowledge-base", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to upload document");
      }

      // Reset form
      setUploadFile(null);
      setUploadTitle("");
      fetchData();
      
      // Poll database for index updates
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const res = await fetch("/api/knowledge-base");
        const freshData = await res.json();
        if (freshData.success) {
          setDocuments(freshData.documents);
          setStats(freshData.stats);
          
          // Stop polling if processing finished or timed out (after 10 attempts)
          const doc = freshData.documents.find((d: DocItem) => d.id === data.document.id);
          if (!doc || doc.status === "INDEXED" || doc.status === "FAILED" || attempts > 10) {
            clearInterval(interval);
          }
        }
      }, 2000);

    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document and all its index chunks?")) {
      return;
    }

    try {
      const response = await fetch(`/api/knowledge-base/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        fetchData();
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  };

  // Handle semantic search
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const response = await fetch("/api/knowledge-base/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.results);
      }
    } catch (err) {
      console.error("Vector search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-muted-foreground mt-1">
          Upload and index documents to ground the Gemini AI agent support responses using Retrieval-Augmented Generation (RAG).
        </p>
      </div>

      {/* Stats Panel */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-border/30 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 p-5 glass">
            <span className="text-xs text-muted-foreground font-medium block">Total Documents</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-foreground">{stats.totalDocuments}</span>
              <span className="text-xxs text-indigo-400 font-semibold uppercase">{stats.indexedDocuments} Indexed</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-5 glass">
            <span className="text-xs text-muted-foreground font-medium block">Vector Chunks</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-foreground">{stats.totalChunks}</span>
              <span className="text-xxs text-emerald-400 font-semibold uppercase">Embedded</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/30 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 p-5 glass">
            <span className="text-xs text-muted-foreground font-medium block">Retrieval Requests</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-foreground">{stats.retrievalRequests}</span>
              <span className="text-xxs text-blue-400 font-semibold uppercase">{stats.successfulRetrievals} Hits</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-5 glass">
            <span className="text-xs text-muted-foreground font-medium block">Avg similarity</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-foreground">
                {stats.averageSimilarityScore > 0 ? `${(stats.averageSimilarityScore * 100).toFixed(1)}%` : "0%"}
              </span>
              <span className="text-xxs text-amber-400 font-semibold uppercase">Score</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Column 1 & 2: Listing & Search */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Document Ingestion List */}
          <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-400" />
                Ingested Documents
              </h3>
              <button 
                onClick={fetchData} 
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-12">
                <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin" />
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border/30 rounded-xl">
                <FileText className="h-10 w-10 text-muted-foreground mb-4 opacity-40" />
                <h4 className="font-semibold text-base">No documents uploaded</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Upload organizational policies, instructions, or FAQ sheets to start grounding your AI chatbot.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/20 max-h-[350px] overflow-y-auto pr-1">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground truncate">{doc.title}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xxs font-semibold ${
                          doc.status === "INDEXED"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : doc.status === "PROCESSING"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                            : doc.status === "FAILED"
                            ? "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                            : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                        }`}>
                          {doc.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{doc.fileName}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="ml-4 p-2 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer"
                      title="Delete document and chunks"
                    >
                      <Trash2 className="h-4.5 w-4.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Similarity Search Test Panel */}
          <div className="rounded-2xl border border-border/40 glass p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <SearchCode className="h-5 w-5 text-indigo-400" />
                Semantic Similarity Search Test
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Query vector similarity directly against Neon PostgreSQL chunks to verify grounding relevance.
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter client query or policy question..."
                className="flex-1 rounded-xl border border-border/40 bg-zinc-900/60 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-650 hover:bg-indigo-600 text-white px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                {searching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Query
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Top Matched Chunks</h4>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {searchResults.map((res, index) => (
                    <div key={res.id} className="rounded-xl border border-border/20 bg-foreground/5 p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-indigo-400">Match Rank #{index + 1}</span>
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-450">
                          {(res.similarity * 100).toFixed(1)}% Cosine similarity
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed italic">
                        &quot;{res.content}&quot;
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Column 3: Upload Panel */}
        <div className="space-y-8">
          <div className="rounded-2xl border border-border/40 glass p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-indigo-400" />
                Upload Knowledge Document
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Support files are parsed, chunked, and stored as vector embeddings.
              </p>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Document Title</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Refund Policy 2026"
                  className="w-full rounded-xl border border-border/40 bg-zinc-900/60 px-4 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Select File (.txt, .pdf, .docx)</label>
                <div className="relative border border-dashed border-border/45 rounded-xl hover:border-indigo-500/50 transition-all p-8 text-center cursor-pointer">
                  <input
                    type="file"
                    accept=".txt,.pdf,.docx"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <UploadCloud className="h-10 w-10 text-muted-foreground/60 mx-auto mb-2" />
                  <span className="text-xs text-foreground font-semibold block truncate">
                    {uploadFile ? uploadFile.name : "Choose a file or drag here"}
                  </span>
                  <span className="text-xxs text-muted-foreground mt-1 block">Maximum size 10MB</span>
                </div>
              </div>

              {uploadError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-450 p-3 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={uploading || !uploadFile}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-650 hover:bg-indigo-600 disabled:opacity-50 text-white py-2.5 text-sm font-semibold transition-all shadow-md cursor-pointer"
              >
                {uploading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                {uploading ? "Ingesting..." : "Ingest Document"}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
