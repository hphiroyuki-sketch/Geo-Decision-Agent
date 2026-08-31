export type Role = "admin" | "member" | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface SSEHandlers {
  onDelta?: (text: string) => void;
  onStep?: (label: string) => void;
  onAnalysisSaved?: (data: { analysisId: string; candidateCount: number }) => void;
  onBudgetExceeded?: (data: { message: string; spentJpySoFar: number; monthlyBudgetJpy: number }) => void;
  onDone?: (data: { costJpy: number }) => void;
  onError?: (message: string) => void;
}

export async function streamChat(conversationId: string, content: string, handlers: SSEHandlers): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.body) throw new Error("ストリームを開始できませんでした。");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "送信に失敗しました。");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      switch (event) {
        case "delta":
          handlers.onDelta?.(parsed.text);
          break;
        case "step":
          handlers.onStep?.(parsed.label);
          break;
        case "analysis_saved":
          handlers.onAnalysisSaved?.(parsed);
          break;
        case "budget_exceeded":
          handlers.onBudgetExceeded?.(parsed);
          break;
        case "done":
          handlers.onDone?.(parsed);
          break;
        case "error":
          handlers.onError?.(parsed.message);
          break;
      }
    }
  }
}
