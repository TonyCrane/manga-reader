import { useId, useState } from "react";
import { X } from "lucide-react";

export function TagInput({
  value,
  onChange,
  placeholder = "添加标签",
  options,
  label = "添加标签",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  options?: string[];
  label?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = (options || [])
    .filter(
      (tag) =>
        !value.includes(tag) &&
        tag.toLocaleLowerCase().includes(input.toLocaleLowerCase()),
    )
    .slice(0, 50);
  function add(tag = input.trim()) {
    if (
      tag &&
      tag.length <= 80 &&
      value.length < 50 &&
      (!options || options.includes(tag))
    ) {
      if (!value.includes(tag)) {
        onChange([...value, tag]);
      }
      setInput("");
      setActive(0);
    }
  }
  return (
    <div className="tag-control">
      <div className="tag-input">
        {value.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`删除标签 ${tag}`}
              onClick={() => onChange(value.filter((item) => item !== tag))}
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          role={options ? "combobox" : undefined}
          aria-autocomplete={options ? "list" : undefined}
          aria-expanded={options ? open : undefined}
          aria-controls={options ? listId : undefined}
          aria-activedescendant={
            options && open && matches[active]
              ? `${listId}-${active}`
              : undefined
          }
          value={input}
          maxLength={80}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setInput(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => {
            if (!options) {
              add();
            }
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (options) {
                const exact = options.find((tag) => tag === input.trim());
                const selected = exact || matches[active];
                if (selected) {
                  add(selected);
                }
              } else {
                add();
              }
            }
            if (event.key === "ArrowDown" && options) {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                Math.min(index + 1, Math.max(0, matches.length - 1)),
              );
            }
            if (event.key === "ArrowUp" && options) {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            }
            if (event.key === "Escape") {
              setOpen(false);
            }
            if (event.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {options && open && (
        <div className="tag-options" id={listId} role="listbox">
          {matches.length ? (
            matches.map((tag, index) => (
              <button
                key={tag}
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(tag)}
              >
                {tag}
              </button>
            ))
          ) : (
            <span>没有可选标签</span>
          )}
        </div>
      )}
    </div>
  );
}
