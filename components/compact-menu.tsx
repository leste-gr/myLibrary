"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure with keyboard, outside-click and navigation dismissal. */
export function CompactMenu({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) ref.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={ref} className={`compact-menu ${className}`}><summary>{label}</summary><div className="compact-menu-panel" onClick={event => {
    if ((event.target as Element).closest("a,button")) ref.current?.removeAttribute("open");
  }}>{children}</div></details>;
}
