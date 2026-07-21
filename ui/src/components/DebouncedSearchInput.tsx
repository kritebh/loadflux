import { useState, useEffect } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { IconSearch } from "./icons";

interface Props {
  onDebouncedChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export function DebouncedSearchInput({
  onDebouncedChange,
  placeholder = "Search…",
  ariaLabel = "Search",
  className = "w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-blue-500",
}: Props) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    onDebouncedChange(debouncedSearch);
  }, [debouncedSearch, onDebouncedChange]);

  return (
    <div className="relative flex-1 min-w-0 max-w-md">
      <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
      />
    </div>
  );
}
