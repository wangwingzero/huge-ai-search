import * as vscode from "vscode";
import {
  ChatAttachment,
  ChatMessage,
  ChatMessageStatus,
  ChatRole,
  ChatThread,
  PersistedState,
  SearchLanguage,
} from "./types";

const STATE_KEY = "hugeAiChat.persistedState.v1";
const TITLE_MAX_LENGTH = 36;

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneState(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState;
}

function normalizeThreadTitle(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "新会话";
  }
  if (compact.length <= TITLE_MAX_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, TITLE_MAX_LENGTH - 3)}...`;
}

function isSearchLanguage(value: unknown): value is SearchLanguage {
  return (
    value === "zh-CN" ||
    value === "en-US" ||
    value === "ja-JP" ||
    value === "ko-KR" ||
    value === "de-DE" ||
    value === "fr-FR"
  );
}

function sanitizeAttachments(input: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    return undefined;
  }
  const result: ChatAttachment[] = [];
  for (const item of input.slice(0, 12)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<ChatAttachment>;
    if (typeof candidate.id !== "string" || typeof candidate.thumbDataUrl !== "string") {
      continue;
    }
    const normalized: ChatAttachment = {
      id: candidate.id,
      thumbDataUrl: candidate.thumbDataUrl,
      originalDataUrl:
        typeof candidate.originalDataUrl === "string" ? candidate.originalDataUrl : undefined,
      width: typeof candidate.width === "number" ? candidate.width : undefined,
      height: typeof candidate.height === "number" ? candidate.height : undefined,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
    };
    result.push(normalized);
  }
  return result.length > 0 ? result : undefined;
}

export class ThreadStore {
  private state: PersistedState;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly maxThreads: number,
    private readonly defaultLanguage: SearchLanguage
  ) {
    this.state = this.loadState();

    if (!this.state.activeThreadId || this.state.threads.length === 0) {
      const thread = this.createThreadObject(this.defaultLanguage);
      this.state.threads = [thread];
      this.state.activeThreadId = thread.id;
      void this.persist();
    }
  }

  getState(): PersistedState {
    return cloneState(this.state);
  }

  getActiveThread(): ChatThread | undefined {
    if (!this.state.activeThreadId) {
      return undefined;
    }
    return this.state.threads.find((thread) => thread.id === this.state.activeThreadId);
  }

  getThread(threadId: string): ChatThread | undefined {
    return this.state.threads.find((thread) => thread.id === threadId);
  }

  async createThread(language: SearchLanguage = this.defaultLanguage): Promise<ChatThread> {
    const thread = this.createThreadObject(language);
    this.state.threads.unshift(thread);
    this.state.activeThreadId = thread.id;
    this.pruneThreads();
    await this.persist();
    return {
      ...thread,
      messages: [...thread.messages],
    };
  }

  async switchThread(threadId: string): Promise<boolean> {
    const thread = this.getThread(threadId);
    if (!thread) {
      return false;
    }
    this.state.activeThreadId = thread.id;
    await this.persist();
    return true;
  }

  async deleteThread(threadId: string): Promise<boolean> {
    const exists = this.state.threads.some((thread) => thread.id === threadId);
    if (!exists) {
      return false;
    }

    this.state.threads = this.state.threads.filter((thread) => thread.id !== threadId);

    if (this.state.threads.length === 0) {
      const thread = this.createThreadObject(this.defaultLanguage);
      this.state.threads = [thread];
      this.state.activeThreadId = thread.id;
    } else if (this.state.activeThreadId === threadId) {
      this.state.activeThreadId = this.state.threads[0].id;
    }

    await this.persist();
    return true;
  }

  async clearHistory(): Promise<void> {
    const thread = this.createThreadObject(this.defaultLanguage);
    this.state = {
      version: 1,
      activeThreadId: thread.id,
      threads: [thread],
    };
    await this.persist();
  }

  async setThreadSessionId(threadId: string, sessionId: string | undefined): Promise<boolean> {
    const thread = this.getThread(threadId);
    if (!thread) {
      return false;
    }
    if (sessionId) {
      thread.sessionId = sessionId;
    } else {
      delete thread.sessionId;
    }
    thread.updatedAt = Date.now();
    await this.persist();
    return true;
  }

  async setThreadLanguage(threadId: string, language: SearchLanguage): Promise<boolean> {
    const thread = this.getThread(threadId);
    if (!thread) {
      return false;
    }
    thread.language = language;
    thread.updatedAt = Date.now();
    await this.persist();
    return true;
  }

  async addMessage(
    threadId: string,
    role: ChatRole,
    content: string,
    status: ChatMessageStatus,
    attachments?: ChatAttachment[]
  ): Promise<ChatMessage | undefined> {
    const thread = this.getThread(threadId);
    if (!thread) {
      return undefined;
    }

    const message: ChatMessage = {
      id: createId("msg"),
      role,
      content,
      attachments: sanitizeAttachments(attachments),
      createdAt: Date.now(),
      status,
    };

    thread.messages.push(message);
    thread.updatedAt = Date.now();

    if (role === "user") {
      const firstUser = thread.messages.find((item) => item.role === "user");
      if (firstUser) {
        thread.title = normalizeThreadTitle(firstUser.content);
      }
    }

    this.reorderThreadToTop(threadId);
    this.pruneThreads();
    await this.persist();
    return { ...message };
  }

  async updateMessage(
    threadId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, "content" | "status">>
  ): Promise<ChatMessage | undefined> {
    const thread = this.getThread(threadId);
    if (!thread) {
      return undefined;
    }

    const message = thread.messages.find((item) => item.id === messageId);
    if (!message) {
      return undefined;
    }

    if (typeof patch.content === "string") {
      message.content = patch.content;
    }
    if (patch.status) {
      message.status = patch.status;
    }

    thread.updatedAt = Date.now();
    this.reorderThreadToTop(threadId);
    await this.persist();
    return { ...message };
  }

  private reorderThreadToTop(threadId: string): void {
    const index = this.state.threads.findIndex((thread) => thread.id === threadId);
    if (index <= 0) {
      return;
    }
    const [thread] = this.state.threads.splice(index, 1);
    this.state.threads.unshift(thread);
  }

  private pruneThreads(): void {
    if (this.state.threads.length <= this.maxThreads) {
      return;
    }

    const keepSet = new Set<string>();
    for (const thread of this.state.threads.slice(0, this.maxThreads)) {
      keepSet.add(thread.id);
    }

    this.state.threads = this.state.threads.filter((thread) => keepSet.has(thread.id));

    if (
      this.state.activeThreadId &&
      !this.state.threads.some((thread) => thread.id === this.state.activeThreadId)
    ) {
      this.state.activeThreadId = this.state.threads.length > 0 ? this.state.threads[0].id : null;
    }
  }

  private createThreadObject(language: SearchLanguage): ChatThread {
    const now = Date.now();
    return {
      id: createId("thread"),
      title: "新会话",
      language,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  private loadState(): PersistedState {
    const raw = this.context.globalState.get<unknown>(STATE_KEY);
    if (!raw || typeof raw !== "object") {
      return { version: 1, activeThreadId: null, threads: [] };
    }

    const candidate = raw as Partial<PersistedState>;
    if (candidate.version !== 1 || !Array.isArray(candidate.threads)) {
      return { version: 1, activeThreadId: null, threads: [] };
    }

    const threads: ChatThread[] = [];
    for (const thread of candidate.threads) {
      if (!thread || typeof thread !== "object") {
        continue;
      }
      const typedThread = thread as Partial<ChatThread>;
      if (typeof typedThread.id !== "string" || typeof typedThread.title !== "string") {
        continue;
      }
      if (!isSearchLanguage(typedThread.language)) {
        continue;
      }

      const messages: ChatMessage[] = [];
      for (const message of typedThread.messages || []) {
        if (!message || typeof message !== "object") {
          continue;
        }
        const typedMessage = message as Partial<ChatMessage>;
        if (
          typeof typedMessage.id !== "string" ||
          (typedMessage.role !== "user" && typedMessage.role !== "assistant") ||
          typeof typedMessage.content !== "string" ||
          typeof typedMessage.createdAt !== "number" ||
          (typedMessage.status !== "pending" &&
            typedMessage.status !== "done" &&
            typedMessage.status !== "error")
        ) {
          continue;
        }
        messages.push({
          id: typedMessage.id,
          role: typedMessage.role,
          content: typedMessage.content,
          attachments: sanitizeAttachments(typedMessage.attachments),
          createdAt: typedMessage.createdAt,
          status: typedMessage.status,
        });
      }

      const normalizedThread: ChatThread = {
        id: typedThread.id,
        title: typedThread.title || "新会话",
        sessionId: typeof typedThread.sessionId === "string" ? typedThread.sessionId : undefined,
        language: typedThread.language,
        createdAt:
          typeof typedThread.createdAt === "number" ? typedThread.createdAt : Date.now(),
        updatedAt:
          typeof typedThread.updatedAt === "number" ? typedThread.updatedAt : Date.now(),
        messages,
      };

      threads.push(normalizedThread);
    }

    const activeThreadId =
      typeof candidate.activeThreadId === "string" &&
      threads.some((thread) => thread.id === candidate.activeThreadId)
        ? candidate.activeThreadId
        : threads.length > 0
          ? threads[0].id
          : null;

    return {
      version: 1,
      activeThreadId,
      threads,
    };
  }

  private async persist(): Promise<void> {
    await this.context.globalState.update(STATE_KEY, this.state);
  }
}
