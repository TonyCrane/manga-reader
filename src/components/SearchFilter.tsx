import { useState } from "react";
import { Search, Check, ChevronDown } from "lucide-react";
import { Sheet } from "./Sheet";

export function SearchFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = options
    .filter((v) => v.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }
  return (
    <>
      <button
        className={`soft-button filter-trigger ${value ? "selected" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={`按${label}筛选`}
      >
        <span>{value || `全部${label}`}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <Sheet title={`筛选${label}`} onClose={() => setOpen(false)}>
          <div className="input-icon">
            <Search size={18} />
            <input
              aria-label={`搜索${label}`}
              placeholder={`搜索${label}`}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="filter-options">
            <button onClick={() => choose("")}>
              全部{label}
              {!value && <Check size={18} />}
            </button>
            {matches.slice(0, 100).map((v) => (
              <button key={v} onClick={() => choose(v)}>
                {v}
                {value === v && <Check size={18} />}
              </button>
            ))}
            {!matches.length && <p className="muted">没有匹配的{label}</p>}
            {matches.length > 100 && (
              <p className="muted">
                还有 {matches.length - 100} 项，请输入关键词缩小范围。
              </p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
