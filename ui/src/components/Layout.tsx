import { memo, useState, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { ConnectionStatus } from "./ConnectionStatus";
import { logout } from "../api/client";

interface Props {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const MemoOutlet = memo(function MemoOutlet() {
  return <Outlet />;
});

export function Layout({ theme, toggleTheme }: Props) {
  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between h-16 px-4 lg:px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <button
            onClick={openSidebar}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <ThemeToggle theme={theme} toggle={toggleTheme} />

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <MemoOutlet />
        </main>
      </div>
    </div>
  );
}
