import { useState, useEffect, useMemo } from "react";
import { fetchSettings, updateSettings, fetchExport } from "../api/client";

const EXPORT_OPTIONS = [
  { label: "Last 1 hour", ms: 60 * 60 * 1000 },
  { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "Last 12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Last 3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "Last 15 days", ms: 15 * 24 * 60 * 60 * 1000 },
  { label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "Last 60 days", ms: 60 * 24 * 60 * 60 * 1000 },
  { label: "Last 90 days", ms: 90 * 24 * 60 * 60 * 1000 },
];

export function Settings() {
  const [retentionDays, setRetentionDays] = useState(90);
  const [slowThreshold, setSlowThreshold] = useState(500);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMs, setExportMs] = useState(24 * 60 * 60 * 1000);

  const exportOptions = useMemo(() => {
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    return EXPORT_OPTIONS.filter((o) => o.ms <= retentionMs);
  }, [retentionDays]);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setRetentionDays(s.retention_days);
        setSlowThreshold(s.slow_threshold);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings({
        retention_days: retentionDays,
        slow_threshold: slowThreshold,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const now = Date.now();
      const data = await fetchExport(now - exportMs, now);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `loadflux-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export data");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Metrics Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-5">
        <h3 className="text-lg font-semibold">Metrics Configuration</h3>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Data Retention (days)
          </label>
          <input
            type="number"
            value={retentionDays}
            onChange={(e) => setRetentionDays(parseInt(e.target.value) || 1)}
            min={1}
            max={365}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
          <p className="mt-1 text-xs text-gray-400">
            Metrics older than this will be automatically deleted
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Slow Request Threshold (ms)
          </label>
          <input
            type="number"
            value={slowThreshold}
            onChange={(e) => setSlowThreshold(parseInt(e.target.value) || 0)}
            min={0}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
          <p className="mt-1 text-xs text-gray-400">
            Requests slower than this will appear in the slow requests table
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {saved && (
            <span className="text-sm text-emerald-500">Settings saved</span>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h3 className="text-lg font-semibold">Export Data</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Export all metrics for the selected time range as JSON.
        </p>

        <div className="flex items-center gap-4 flex-wrap">
          <select
            value={exportMs}
            onChange={(e) => setExportMs(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          >
            {exportOptions.map((o) => (
              <option key={o.ms} value={o.ms}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export JSON"}
          </button>
        </div>
      </div>

      {/* About */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-2">
        <h3 className="text-lg font-semibold">About LoadFlux</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Lightweight embedded server monitoring dashboard for Node.js.
        </p>
        <a
          href="https://loadflux.kritebh.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          Documentation
        </a>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}
        </p>
      </div>
    </div>
  );
}
