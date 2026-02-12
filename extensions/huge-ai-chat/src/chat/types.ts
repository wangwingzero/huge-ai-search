export type SearchLanguage =
  | "zh-CN"
  | "en-US"
  | "ja-JP"
  | "ko-KR"
  | "de-DE"
  | "fr-FR";

export type ChatRole = "user" | "assistant";
export type ChatMessageStatus = "pending" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status: ChatMessageStatus;
}

export interface ChatThread {
  id: string;
  title: string;
  sessionId?: string;
  language: SearchLanguage;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface PersistedState {
  version: 1;
  activeThreadId: string | null;
  threads: ChatThread[];
}

export interface SearchSource {
  title: string;
  url: string;
}

export interface ParsedSearchResponse {
  raw: string;
  answer: string;
  renderedMarkdown: string;
  sources: SearchSource[];
  sessionId?: string;
  debugText?: string;
  isError: boolean;
  isAuthError: boolean;
}

export type ChatStatusKind = "idle" | "progress" | "success" | "warning" | "error";

export interface ChatStatusSnapshot {
  kind: ChatStatusKind;
  title: string;
  detail?: string;
  suggestion?: string;
  threadId?: string;
  at: number;
}

export type PanelToHostMessage =
  | { type: "panel/ready" }
  | { type: "thread/create"; language?: SearchLanguage }
  | { type: "thread/clearAll" }
  | { type: "thread/switch"; threadId: string }
  | { type: "thread/delete"; threadId: string }
  | { type: "chat/send"; threadId: string; text: string; language?: SearchLanguage }
  | { type: "chat/retryLast"; threadId: string }
  | { type: "auth/runSetup" };

export type HostToPanelMessage =
  | { type: "state/full"; state: PersistedState }
  | { type: "state/updated"; state: PersistedState }
  | { type: "chat/status"; status: ChatStatusSnapshot }
  | { type: "chat/pending"; threadId: string; messageId: string }
  | { type: "chat/answer"; threadId: string; message: ChatMessage }
  | {
      type: "chat/error";
      threadId: string;
      message: ChatMessage;
      error: string;
      canRetry: boolean;
    }
  | { type: "auth/running" }
  | { type: "auth/completed"; success: boolean; message: string };
