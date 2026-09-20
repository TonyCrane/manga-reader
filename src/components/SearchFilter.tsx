import { useId, useMemo, useState } from "react";
import { Search, Check, ChevronDown, X } from "lucide-react";
import { Sheet } from "./Sheet";

const optionCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function normalizedSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

export function SearchFilter({
  label,
  options,
  optionCounts,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  optionCounts?: ReadonlyMap<string, number>;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const matches = useMemo(() => {
    const terms = normalizedSearch(query).split(/\s+/).filter(Boolean);
    return options
      .filter((option) => {
        const name = normalizedSearch(option);
        return terms.every((term) => name.includes(term));
      })
      .sort(optionCollator.compare);
  }, [options, query]);
  const unit = label === "作者" ? "位作者" : `项${label}`;

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(v: string) {
    onChange(v);
    close();
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
        <Sheet title={`筛选${label}`} onClose={close}>
          <div className="input-icon filter-search">
            <Search size={18} />
            <input
              aria-label={`搜索${label}`}
              placeholder={`搜索${label}`}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="icon"
                aria-label={`清除${label}搜索`}
                onClick={() => setQuery("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <p className="filter-summary" aria-live="polite">
            {query
              ? `找到 ${matches.length} ${unit}`
              : `共 ${options.length} ${unit}`}
          </p>
          <div
            className="filter-options"
            id={listId}
            role="listbox"
            aria-label={`${label}列表`}
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => choose("")}
            >
              <span className="filter-option-name">全部{label}</span>
              {!value && <Check size={18} />}
            </button>
            {matches.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={value === option}
                onClick={() => choose(option)}
              >
                <span className="filter-option-name">{option}</span>
                <span className="filter-option-meta">
                  {optionCounts?.has(option) && (
                    <span className="filter-option-count">
                      {optionCounts.get(option)} 部
                    </span>
                  )}
                  {value === option && <Check size={18} />}
                </span>
              </button>
            ))}
            {!matches.length && (
              <p className="filter-options-empty">没有匹配的{label}</p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
