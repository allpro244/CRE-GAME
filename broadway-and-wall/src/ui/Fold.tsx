import { useState, type ReactNode } from "react";

/**
 * A SECTION THAT CAN BE PUT AWAY.
 *
 * Every desk is the same shape now: what it says (the strip), what wants you
 * (the letters, the alarms), then the detail. The detail is where the depth
 * lives and none of it is cut — but a page that opens every chart and every
 * mandate editor at once makes the player climb past them on every visit.
 * A Fold is a section head that opens and shuts, carries a one-line summary
 * so a shut section still says something, and remembers its state per
 * viewer. The head is a real `.page-section-head`, so the section rail still
 * finds it (the summary sits after a " · ", which the rail trims off).
 */
export default function Fold({ id, title, summary, defaultOpen = false, children }: {
  /** Storage key — stable per section, e.g. "portfolio:risk". */
  id: string;
  title: string;
  /** What the section would tell you, in a line — shown open or shut. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `bw:fold:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      if (v === "1") return true;
      if (v === "0") return false;
    } catch { /* storage blocked */ }
    return defaultOpen;
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* storage blocked */ }
      return !o;
    });
  };
  return (
    <div className={"page-section fold" + (open ? " fold-open" : "")}>
      <button type="button" className="page-section-head fold-head" aria-expanded={open} onClick={toggle}>
        {title}
        {summary ? <>{" · "}<span className="fold-summary">{summary}</span></> : null}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}
