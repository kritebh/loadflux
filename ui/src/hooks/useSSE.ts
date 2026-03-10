import { useState, useEffect, useRef, createContext, useContext } from "react";
import { getApiBase, type DashboardSnapshot } from "../api/client";

interface SSEState {
  snapshot: DashboardSnapshot | null;
  connected: boolean;
}

const SSEContext = createContext<SSEState>({
  snapshot: null,
  connected: false,
});

export function useSSEProvider(): SSEState {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${getApiBase()}/sse`;

    // Auth handled via HttpOnly cookie (withCredentials: true)
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DashboardSnapshot;
        setSnapshot(data);
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return { snapshot, connected };
}

export { SSEContext };

export function useSSE(): SSEState {
  return useContext(SSEContext);
}
