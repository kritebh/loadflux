import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./CopyPageButton.module.css";

/**
 * "Copy page for LLM" button shown on every doc page.
 *
 * It consumes the Markdown twin that `@signalwire/docusaurus-plugin-llms-txt`
 * emits for each route at build time (e.g. `/docs/guides/sse-real-time` →
 * `/docs/guides/sse-real-time.md`, and the docs index `/docs/` → `/docs.md`).
 */

type IconProps = { className?: string };

function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MarkdownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 15V9l3 3 3-3v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 9v4m0 0 2-2m-2 2-2-2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M14 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4 11 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 4 2.5 20h19L12 4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

/** Route pathname → path of its generated Markdown twin. */
function toMarkdownPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return `${trimmed || "/index"}.md`;
}

export default function CopyPageButton(): React.JSX.Element {
  const { pathname } = useLocation();
  const { siteConfig } = useDocusaurusContext();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mdPath = toMarkdownPath(pathname);
  const absoluteMdUrl = `${siteConfig.url}${mdPath}`;
  const aiPrompt = `Read ${absoluteMdUrl} and help me with questions about this LoadFlux documentation page.`;

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(copyResetRef.current), []);

  const flashStatus = useCallback((next: "copied" | "error") => {
    setStatus(next);
    clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setStatus("idle"), 2200);
  }, []);

  const handleCopy = useCallback(async () => {
    setOpen(false);
    try {
      const res = await fetch(mdPath, {
        headers: { Accept: "text/markdown, text/plain" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // The .md twins are generated by the plugin's postBuild step, so they only
      // exist in a production build. In `docusaurus start` (dev) the server returns
      // the SPA HTML shell instead — never copy that.
      const looksLikeHtml =
        /^\s*<(?:!doctype|html\b)/i.test(body) ||
        body.includes('<div id="__docusaurus">');
      if (!body.trim() || looksLikeHtml) throw new Error("markdown-unavailable");
      await navigator.clipboard.writeText(body);
      flashStatus("copied");
    } catch {
      flashStatus("error");
    }
  }, [mdPath, flashStatus]);

  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }, []);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Copy this page for an LLM"
        title={
          status === "error"
            ? "Markdown version not found (only generated in a production build)"
            : undefined
        }
        onClick={() => setOpen((v) => !v)}
      >
        {status === "copied" ? (
          <CheckIcon className={styles.leadIcon} />
        ) : status === "error" ? (
          <AlertIcon className={styles.leadIcon} />
        ) : (
          <CopyIcon className={styles.leadIcon} />
        )}
        <span>
          {status === "copied"
            ? "Copied!"
            : status === "error"
              ? "Unavailable"
              : "Copy page"}
        </span>
        <ChevronIcon className={styles.chevron} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" className={styles.item} onClick={handleCopy}>
            <CopyIcon className={styles.itemIcon} />
            <span className={styles.itemLabel}>
              Copy as Markdown
              <span className={styles.itemDesc}>Copy this page as clean Markdown</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => openExternal(mdPath)}
          >
            <MarkdownIcon className={styles.itemIcon} />
            <span className={styles.itemLabel}>
              View as Markdown
              <span className={styles.itemDesc}>Open the raw .md version</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => openExternal(`https://chatgpt.com/?q=${encodeURIComponent(aiPrompt)}`)}
          >
            <ExternalIcon className={styles.itemIcon} />
            <span className={styles.itemLabel}>
              Open in ChatGPT
              <span className={styles.itemDesc}>Ask ChatGPT about this page</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => openExternal(`https://claude.ai/new?q=${encodeURIComponent(aiPrompt)}`)}
          >
            <ExternalIcon className={styles.itemIcon} />
            <span className={styles.itemLabel}>
              Open in Claude
              <span className={styles.itemDesc}>Ask Claude about this page</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
