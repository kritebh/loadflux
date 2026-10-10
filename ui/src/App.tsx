import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./hooks/useTheme";
import { useSSEConnectionProvider, SSEConnectionContext } from "./hooks/useSSE";
import { checkAuthStatus, getAppBasePath } from "./api/client";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

const System = lazy(() =>
  import("./pages/System").then((m) => ({ default: m.System })),
);
const Endpoints = lazy(() =>
  import("./pages/Endpoints").then((m) => ({ default: m.Endpoints })),
);
const AppMetrics = lazy(() =>
  import("./pages/AppMetrics").then((m) => ({ default: m.AppMetrics })),
);
const Errors = lazy(() =>
  import("./pages/Errors").then((m) => ({ default: m.Errors })),
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      Loading...
    </div>
  );
}

type AuthState = "loading" | "login" | "setup" | "authenticated";

function AuthenticatedApp() {
  const { theme, toggle } = useTheme();
  const { connected } = useSSEConnectionProvider();
  const sseContextValue = useMemo(() => ({ connected }), [connected]);

  return (
    <SSEConnectionContext.Provider value={sseContextValue}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            element={
              <Layout
                theme={theme}
                toggleTheme={toggle}
              />
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="system" element={<System />} />
            <Route path="endpoints" element={<Endpoints />} />
            <Route path="app-metrics" element={<AppMetrics />} />
            <Route path="errors" element={<Errors />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </SSEConnectionContext.Provider>
  );
}

function AppContent() {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    checkAuthStatus()
      .then((res) => {
        if (!res.configured) {
          setAuthState("setup");
        } else if (res.authenticated) {
          setAuthState("authenticated");
        } else {
          setAuthState("login");
        }
      })
      .catch(() => {
        setAuthState("login");
      });
  }, []);

  if (authState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (authState === "login" || authState === "setup") {
    return (
      <Login
        authConfigured={authState === "login"}
        onSuccess={() => {
          const base = getAppBasePath().replace(/\/$/, "") || "";
          window.history.replaceState(null, "", `${base}/`);
          setAuthState("authenticated");
        }}
      />
    );
  }

  const basePath = getAppBasePath();

  return (
    <BrowserRouter basename={basePath}>
      <AuthenticatedApp />
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
