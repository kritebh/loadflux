function getBasePath(): string {
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_BASE_PATH || "/loadflux";
  }
  // In production, detect from the bundled script URL
  try {
    const url = new URL(import.meta.url);
    const idx = url.pathname.lastIndexOf("/assets/");
    if (idx !== -1) return url.pathname.substring(0, idx);
  } catch {}
  return "/loadflux";
}

const BASE_PATH = getBasePath();
const API_BASE = `${BASE_PATH}/api`;

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

export function getApiBase(): string {
  return API_BASE;
}

export function getAppBasePath(): string {
  return BASE_PATH;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (res.status === 401) {
    throw new AuthError("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Auth
export function checkAuthStatus() {
  return apiFetch<{ configured: boolean; authenticated: boolean }>(
    "/auth/status",
  );
}

export async function logout() {
  await fetch(`${API_BASE}/logout`, {
    method: "POST",
    credentials: "same-origin",
  });
  setToken(null);
}

export function login(username: string, password: string) {
  return apiFetch<{ token: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function setupAuth(username: string, password: string) {
  return apiFetch<{ ok: boolean; token: string }>("/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// System
export function fetchSystemMetrics(
  from: number,
  to: number,
  maxPoints?: number,
  instance?: string,
) {
  let url = `/system?from=${from}&to=${to}`;
  if (maxPoints) url += `&max_points=${maxPoints}`;
  if (instance) url += `&instance=${encodeURIComponent(instance)}`;
  return apiFetch<SystemMetricRow[]>(url);
}

// Process
export function fetchProcessMetrics(
  from: number,
  to: number,
  maxPoints?: number,
  instance?: string,
) {
  let url = `/process?from=${from}&to=${to}`;
  if (maxPoints) url += `&max_points=${maxPoints}`;
  if (instance) url += `&instance=${encodeURIComponent(instance)}`;
  return apiFetch<ProcessMetricRow[]>(url);
}

export function fetchInstances(from: number, to: number) {
  return apiFetch<{ instances: string[] }>(
    `/instances?from=${from}&to=${to}`,
  );
}

// Endpoints
export function fetchEndpointMetrics(from: number, to: number) {
  return apiFetch<EndpointMetricRow[]>(`/endpoints?from=${from}&to=${to}`);
}

export function fetchTopEndpoints(
  metric: string,
  from: number,
  to: number,
  limit = 10,
  search?: string,
) {
  let url = `/endpoints/top?metric=${metric}&limit=${limit}&from=${from}&to=${to}`;
  if (search?.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
  return apiFetch<TopEndpointRow[]>(url);
}

export function fetchSlowRequests(from: number, to: number, threshold?: number) {
  let url = `/endpoints/slow?from=${from}&to=${to}`;
  if (threshold) url += `&threshold=${threshold}`;
  return apiFetch<EndpointMetricRow[]>(url);
}

// Errors
export function fetchErrors(from: number, to: number) {
  return apiFetch<ErrorLogRow[]>(`/errors?from=${from}&to=${to}`);
}

export function fetchStatusDistribution(from: number, to: number) {
  return apiFetch<StatusDistribution>(`/errors/distribution?from=${from}&to=${to}`);
}

export function fetchErrorStatusCodes(from: number, to: number) {
  return apiFetch<{ codes: number[] }>(
    `/errors/status-codes?from=${from}&to=${to}`,
  );
}

// Overview
export function fetchOverview(from: number, to: number) {
  return apiFetch<OverviewMetrics>(`/overview?from=${from}&to=${to}`);
}

// Snapshot
export function fetchSnapshot() {
  return apiFetch<DashboardSnapshot>("/snapshot");
}

// Export
export function fetchExport(from: number, to: number) {
  return apiFetch<ExportData>(`/export?from=${from}&to=${to}`);
}

// Settings
export function fetchSettings() {
  return apiFetch<SettingsData>("/settings");
}

export function updateSettings(settings: Partial<SettingsData>) {
  return apiFetch<{ ok: boolean }>("/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function fetchEndpointMetricsPaginated(
  from: number,
  to: number,
  page: number,
  limit = 200,
  search?: string,
) {
  let url = `/endpoints?from=${from}&to=${to}&page=${page}&limit=${limit}`;
  if (search?.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
  return apiFetch<PaginatedResponse<EndpointMetricRow>>(url);
}

export function fetchSlowRequestsPaginated(
  from: number,
  to: number,
  page: number,
  limit = 200,
  threshold?: number,
  search?: string,
) {
  let url = `/endpoints/slow?from=${from}&to=${to}&page=${page}&limit=${limit}`;
  if (threshold) url += `&threshold=${threshold}`;
  if (search?.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
  return apiFetch<PaginatedResponse<EndpointMetricRow>>(url);
}

export function fetchErrorsPaginated(
  from: number,
  to: number,
  page: number,
  limit = 200,
  search?: string,
  status?: string,
) {
  let url = `/errors?from=${from}&to=${to}&page=${page}&limit=${limit}`;
  if (search?.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  return apiFetch<PaginatedResponse<ErrorLogRow>>(url);
}

// Types (mirrors server types)
export interface SystemMetricRow {
  timestamp: number;
  cpu_percent: number;
  mem_total: number;
  mem_used: number;
  mem_percent: number;
  disk_total: number | null;
  disk_used: number | null;
  disk_percent: number | null;
  net_rx_bytes: number;
  net_tx_bytes: number;
}

export interface ProcessMetricRow {
  timestamp: number;
  heap_used: number;
  heap_total: number;
  external_mem: number;
  event_loop_avg_ms: number;
  event_loop_max_ms: number;
  gc_pause_ms: number;
  uptime_seconds: number;
}

export interface EndpointMetricRow {
  timestamp: number;
  method: string;
  path: string;
  request_count: number;
  error_count: number;
  total_duration: number;
  min_duration: number;
  max_duration: number;
  avg_duration: number;
  p50_duration: number;
  p90_duration: number;
  p95_duration: number;
  p99_duration: number;
  total_res_bytes: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}

export interface TopEndpointRow {
  method: string;
  path: string;
  value: number;
}

export interface ErrorLogRow {
  timestamp: number;
  method: string;
  path: string;
  status_code: number;
  error_msg: string | null;
  stack_trace: string | null;
  duration_ms: number;
}

export interface StatusDistribution {
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}

export interface OverviewMetrics {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  avg_duration: number;
  rps: number;
  rpm: number;
}

export interface DashboardSnapshot {
  system: {
    cpu_percent: number;
    mem_percent: number;
    mem_used: number;
    mem_total: number;
    disk_percent: number | null;
    net_rx_bytes: number;
    net_tx_bytes: number;
  };
  process: {
    heap_used: number;
    heap_total: number;
    event_loop_avg_ms: number;
    event_loop_max_ms: number;
    gc_pause_ms: number;
    uptime_seconds: number;
  };
  overview: {
    rps: number;
    rpm: number;
    total_requests: number;
    error_rate: number;
    avg_duration: number;
    p95_duration: number;
    p99_duration: number;
  };
  endpoints: {
    top_by_requests: TopEndpointRow[];
    top_by_latency: TopEndpointRow[];
    top_by_errors: TopEndpointRow[];
    status: StatusDistribution;
  };
  server: {
    node_version: string;
    platform: string;
    pid: number;
    sse_connections: number;
    instance_id?: string;
    cluster_instances?: number;
    cluster_enabled?: boolean;
  };
  timestamp: number;
}

export interface SettingsData {
  retention_days: number;
  slow_threshold: number;
}

export interface ExportData {
  system: SystemMetricRow[];
  process: ProcessMetricRow[];
  endpoints: EndpointMetricRow[];
  errors: ErrorLogRow[];
}
