import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Sheet({
  title,
  className = "",
  children,
  onClose,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement;
    el.showModal();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="sheet-inner">
        <div className="handle" />
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
