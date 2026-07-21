import { useContext } from "react";
import { SSEConnectionContext, useServerInstanceId } from "../hooks/useSSE";

export function ConnectionStatus() {
  const { connected } = useContext(SSEConnectionContext);
  const instanceId = useServerInstanceId();

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full ${
          connected ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
      <span className="text-gray-500 dark:text-gray-400 hidden sm:inline">
        {connected ? "Live" : "Disconnected"}
        {instanceId && (
          <span className="hidden md:inline font-mono text-xs ml-1">
            ({instanceId})
          </span>
        )}
      </span>
    </div>
  );
}
