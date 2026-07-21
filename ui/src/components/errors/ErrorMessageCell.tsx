import { memo, useCallback } from "react";
import type { ErrorLogRow } from "../../api/client";

interface Props {
  row: ErrorLogRow;
  expanded: boolean;
  onToggle: (timestamp: number) => void;
}

export const ErrorMessageCell = memo(function ErrorMessageCell({
  row,
  expanded,
  onToggle,
}: Props) {
  const handleClick = useCallback(() => {
    onToggle(row.timestamp);
  }, [onToggle, row.timestamp]);

  return (
    <button
      onClick={handleClick}
      className="text-left max-w-xs truncate text-blue-500 hover:underline"
      title={row.error_msg ?? ""}
      aria-expanded={expanded}
    >
      {row.error_msg || "-"}
    </button>
  );
});
