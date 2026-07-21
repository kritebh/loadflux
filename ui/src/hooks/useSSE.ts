import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  useSyncExternalStore,
} from "react";
import { getApiBase, type DashboardSnapshot } from "../api/client";

interface SSEState {
  snapshot: DashboardSnapshot | null;
  connected: boolean;
}

let snapshotStore: DashboardSnapshot | null = null;
const snapshotListeners = new Set<() => void>();

function subscribeSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

function getSnapshotStore(): DashboardSnapshot | null {
  return snapshotStore;
}

function setSnapshotStore(data: DashboardSnapshot): void {
  snapshotStore = data;
  for (const listener of snapshotListeners) {
    listener();
  }
}

const SSEConnectionContext = createContext({ connected: false });

/** Opens SSE at app level; only `connected` triggers app-wide re-renders. */
export function useSSEConnectionProvider(): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${getApiBase()}/sse`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DashboardSnapshot;
        setSnapshotStore(data);
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      snapshotStore = null;
      for (const listener of snapshotListeners) {
        listener();
      }
    };
  }, []);

  return { connected };
}

export { SSEConnectionContext };

/** Subscribes to live snapshot; only components calling this re-render on SSE ticks. */
export function useSSE(): SSEState {
  const { connected } = useContext(SSEConnectionContext);
  const snapshot = useSyncExternalStore(
    subscribeSnapshot,
    getSnapshotStore,
    getSnapshotStore,
  );
  return { snapshot, connected };
}

/** Instance id from SSE — re-renders only when the id string changes. */
export function useServerInstanceId(): string | null {
  const [instanceId, setInstanceId] = useState<string | null>(
    () => snapshotStore?.server.instance_id ?? null,
  );

  useEffect(() => {
    return subscribeSnapshot(() => {
      const next = snapshotStore?.server.instance_id ?? null;
      setInstanceId((prev) => (prev === next ? prev : next));
    });
  }, []);

  return instanceId;
}
