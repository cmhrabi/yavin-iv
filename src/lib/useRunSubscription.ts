"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientToServer,
  Event,
  Run,
  ServerToClient,
  Stage,
} from "@yavin/protocol";

const RECONNECT_DELAY_MS = 1000;

export interface RunSubscriptionState {
  run: Run;
  stages: Stage[];
  events: Event[];
}

export interface RunSubscription extends RunSubscriptionState {
  connected: boolean;
  send: (msg: ClientToServer) => boolean;
}

export function useRunSubscription(initial: RunSubscriptionState): RunSubscription {
  const [state, setState] = useState<RunSubscriptionState>(initial);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);

  const runId = initial.run.id;

  const send = useCallback((msg: ClientToServer): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    closedRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws?role=client`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setConnected(true);
        ws.send(JSON.stringify({ kind: "subscribe", runIds: [runId] }));
      });

      ws.addEventListener("message", (ev) => {
        let msg: ServerToClient;
        try {
          msg = JSON.parse(ev.data) as ServerToClient;
        } catch {
          return;
        }
        setState((prev) => applyMessage(prev, msg));
      });

      ws.addEventListener("close", () => {
        setConnected(false);
        wsRef.current = null;
        if (closedRef.current) return;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => {
        // close will follow
      });
    }

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close(1000, "unmount");
        } catch {
          // ignore
        }
      }
    };
  }, [runId]);

  return { ...state, connected, send };
}

function applyMessage(
  prev: RunSubscriptionState,
  msg: ServerToClient,
): RunSubscriptionState {
  switch (msg.kind) {
    case "run.snapshot":
      return { run: msg.run, stages: msg.stages, events: msg.events };
    case "run.updated":
      if (msg.run.id !== prev.run.id) return prev;
      return { ...prev, run: msg.run };
    case "stage.updated":
      if (msg.stage.runId !== prev.run.id) return prev;
      return {
        ...prev,
        stages: prev.stages.map((s) => (s.id === msg.stage.id ? msg.stage : s)),
      };
    case "event.appended": {
      if (msg.event.runId !== prev.run.id) return prev;
      if (prev.events.some((e) => e.seq === msg.event.seq)) return prev;
      return { ...prev, events: [...prev.events, msg.event] };
    }
    case "gate.awaiting":
      return prev;
    default:
      return prev;
  }
}
