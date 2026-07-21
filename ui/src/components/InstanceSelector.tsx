import { useEffect, useState } from "react";
import { AuthError, fetchInstances } from "../api/client";
import type { TimeRangeValue } from "../hooks/useMetrics";

const INSTANCES_REFRESH_MS = 60_000;

interface InstanceSelectorProps {
  getRange: () => TimeRangeValue;
  rangeSyncToken: number;
  value: string;
  onChange: (instance: string) => void;
}

export function InstanceSelector({
  getRange,
  rangeSyncToken,
  value,
  onChange,
}: InstanceSelectorProps) {
  const [instances, setInstances] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      const { from, to } = getRange();
      void fetchInstances(from, to)
        .then((res) => {
          if (!cancelled) setInstances(res.instances);
        })
        .catch((err: unknown) => {
          if (err instanceof AuthError || (err instanceof Error && err.name === "AuthError")) {
            throw err;
          }
          if (!cancelled) setInstances([]);
        });
    };

    load();
    const intervalId = setInterval(load, INSTANCES_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [getRange, rangeSyncToken]);

  if (instances.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="instance-select"
        className="text-sm text-gray-500 dark:text-gray-400"
      >
        Instance
      </label>
      <select
        id="instance-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1.5"
      >
        <option value="">All instances</option>
        {instances.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>
  );
}
