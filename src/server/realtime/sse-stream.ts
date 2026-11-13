export function formatSseEvent(params: {
  event?: string;
  id?: string;
  data: unknown;
  retry?: number;
}): string {
  let message = "";
  if (params.retry !== undefined) {
    message += `retry: ${params.retry}\n`;
  }
  if (params.id) {
    message += `id: ${params.id}\n`;
  }
  if (params.event) {
    message += `event: ${params.event}\n`;
  }
  const payload = typeof params.data === "string" ? params.data : JSON.stringify(params.data);
  message += `data: ${payload}\n\n`;
  return message;
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export interface SseStreamOptions {
  requestSignal?: AbortSignal;
  pingIntervalMs?: number;
  onConnect?: (writer: {
    sendEvent: (params: { event?: string; id?: string; data: unknown }) => void;
    sendComment: (comment: string) => void;
    sendRaw: (raw: string) => void;
    close: () => void;
  }) => (() => void) | void;
}

export function createSseResponse(options: SseStreamOptions = {}): Response {
  const encoder = new TextEncoder();
  const pingIntervalMs = options.pingIntervalMs ?? 25_000;
  let isClosed = false;
  let pingTimer: NodeJS.Timeout | null = null;
  let cleanupCallback: (() => void) | void = undefined;

  const stream = new ReadableStream({
    start(controller) {
      function safeEnqueue(text: string) {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          safeClose();
        }
      }

      function safeClose() {
        if (isClosed) return;
        isClosed = true;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (cleanupCallback) {
          try {
            cleanupCallback();
          } catch {
            // suppress cleanup errors
          }
          cleanupCallback = undefined;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // Initial connection established comment
      safeEnqueue(formatSseComment("connected"));

      // Setup 25s keepalive ping
      pingTimer = setInterval(() => {
        safeEnqueue(formatSseComment("ping"));
      }, pingIntervalMs);

      // Handle client disconnect / abort signal
      if (options.requestSignal) {
        options.requestSignal.addEventListener("abort", () => {
          safeClose();
        });
      }

      if (options.onConnect) {
        cleanupCallback = options.onConnect({
          sendEvent: (params) => safeEnqueue(formatSseEvent(params)),
          sendComment: (comment) => safeEnqueue(formatSseComment(comment)),
          sendRaw: (raw) => safeEnqueue(raw),
          close: safeClose,
        });
      }
    },
    cancel() {
      if (isClosed) return;
      isClosed = true;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (cleanupCallback) {
        try {
          cleanupCallback();
        } catch {
          // suppress cleanup errors
        }
        cleanupCallback = undefined;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
