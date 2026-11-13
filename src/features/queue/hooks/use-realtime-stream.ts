"use client";

import { useEffect, useRef, useState } from "react";

export interface UseRealtimeStreamOptions<T> {
  url: string | null;
  enabled?: boolean;
  eventNames?: string[];
  onMessage?: (data: T, eventType: string) => void;
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
  maxConsecutiveErrors?: number;
  pollIntervalMs?: number;
}

export interface UseRealtimeStreamResult {
  isConnected: boolean;
  isDegradedToPolling: boolean;
  reconnect: () => void;
}

export function useRealtimeStream<T = unknown>({
  url,
  enabled = true,
  eventNames = ["message", "queue_snapshot", "token_update"],
  onMessage,
  onReconnect,
  onError,
  maxConsecutiveErrors = 3,
  pollIntervalMs = 5_000,
}: UseRealtimeStreamOptions<T>): UseRealtimeStreamResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isDegradedToPolling, setIsDegradedToPolling] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDegradedRef = useRef(false);

  // Keep latest callbacks in refs to avoid re-subscribing on function identity changes
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !url || typeof window === "undefined") {
      setIsConnected(false);
      return;
    }

    let isMounted = true;

    function cleanupCurrentEventSource() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }

    function clearPollingTimer() {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    }

    function startPollingFallback() {
      clearPollingTimer();
      isDegradedRef.current = true;
      setIsDegradedToPolling(true);
      setIsConnected(false);

      pollingTimerRef.current = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          onReconnectRef.current?.();
        }
      }, pollIntervalMs);
    }

    function connect() {
      if (!isMounted || !url) return;

      cleanupCurrentEventSource();

      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!isMounted) return;
          consecutiveErrorsRef.current = 0;
          isDegradedRef.current = false;
          setIsConnected(true);
          setIsDegradedToPolling(false);
          clearPollingTimer();
          // Trigger reconciliation fetch to sync any events missed during connection handshake
          onReconnectRef.current?.();
        };

        for (const evtName of eventNames) {
          es.addEventListener(evtName, (event) => {
            if (!isMounted) return;
            consecutiveErrorsRef.current = 0;
            try {
              const data = JSON.parse((event as MessageEvent).data) as T;
              onMessageRef.current?.(data, evtName);
            } catch {
              // Not JSON; pass raw string
              onMessageRef.current?.((event as MessageEvent).data as T, evtName);
            }
          });
        }

        es.onerror = (err) => {
          if (!isMounted) return;
          consecutiveErrorsRef.current += 1;
          setIsConnected(false);
          onErrorRef.current?.(err);

          if (consecutiveErrorsRef.current >= maxConsecutiveErrors) {
            cleanupCurrentEventSource();
            startPollingFallback();
          }
        };
      } catch (err) {
        onErrorRef.current?.(err);
        startPollingFallback();
      }
    }

    // Connect initially
    connect();

    // Reconcile on tab visibility restore
    function handleVisibilityChange() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        onReconnectRef.current?.();
        if (isDegradedRef.current && consecutiveErrorsRef.current >= maxConsecutiveErrors) {
          // Attempt restoring SSE stream when returning to active tab
          consecutiveErrorsRef.current = 0;
          connect();
        }
      }
    }

    // Reconcile on network reconnect
    function handleOnline() {
      onReconnectRef.current?.();
      if (!eventSourceRef.current) {
        consecutiveErrorsRef.current = 0;
        connect();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      cleanupCurrentEventSource();
      clearPollingTimer();
    };
  }, [url, enabled, eventNames, maxConsecutiveErrors, pollIntervalMs]);

  const reconnect = () => {
    consecutiveErrorsRef.current = 0;
    setIsDegradedToPolling(false);
    onReconnectRef.current?.();
  };

  return {
    isConnected,
    isDegradedToPolling,
    reconnect,
  };
}
