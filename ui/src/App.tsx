import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { useTheme } from "./hooks/useTheme";
import { useSSEProvider, SSEContext } from "./hooks/useSSE";
import { checkAuthStatus, getAppBasePath, AuthError } from "./api/client";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { System } from "./pages/System";
import { Endpoints } from "./pages/Endpoints";
import { AppMetrics } from "./pages/AppMetrics";
import { Errors } from "./pages/Errors";
import { Settings } from "./pages/Settings";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

type AuthState = "loading" | "login" | "setup" | "authenticated";

function AuthenticatedApp() {
  const { theme, toggle } = useTheme();
  const sseState = useSSEProvider();

  return (
    <SSEContext.Provider value={sseState}>
      <Routes>
        <Route
          element={
            <Layout
              theme={theme}
              toggleTheme={toggle}
              connected={sseState.connected}
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
    </SSEContext.Provider>
  );
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    checkAuthStatus()
      .then((res) => {
        setAuthState(res.configured ? "authenticated" : "setup");
      })
      .catch((err) => {
        if (err instanceof AuthError) {
          setAuthState("login");
        } else {
          setAuthState("authenticated");
        }
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
        onSuccess={() => setAuthState("authenticated")}
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
