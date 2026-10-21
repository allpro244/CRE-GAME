/**
 * THE DRAWER BESIDE THE CITY (BUILD_SPEC 2.3): header, tabs, a scrolling
 * body and a sticky footer for the verbs. No subtitle, no kicker prose.
 */
import type { ReactNode } from "react";

export interface Verb {
  label: string;
  run: () => void;
  primary?: boolean;
  key?: string;
  /** Why it cannot run, at most 8 words. Present = disabled. */
  disabled?: string;
  danger?: boolean;
}

export interface DrawerProps {
  width: "std" | "wide";
  crumbs?: string[];
  title: string;
  meta?: string;
  chips?: { label: string; tone?: "gold" | "teal" | "red" }[];
  tabs?: { id: string; label: string; count?: number }[];
  tab?: string;
  onTab?: (id: string) => void;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ width, crumbs, title, meta, chips, tabs, tab, onTab, footer, onClose, children }: DrawerProps) {
  return (
    <section className={"nx-drawer nx-drawer-" + width} aria-label={title}>
      <header className="nx-dr-head">
        <div className="nx-dr-titles">
          {crumbs && crumbs.length > 0 && <div className="nx-crumbs">{crumbs.join(" › ")}</div>}
          <div className="nx-dr-title">
            {title}
            {chips?.map((c) => <span key={c.label} className={"nx-chip nx-chip-" + (c.tone ?? "gold")}>{c.label}</span>)}
          </div>
          {meta && <div className="nx-dr-meta mono">{meta}</div>}
        </div>
        <button type="button" className="nx-x" aria-label="Close" onClick={onClose}>×</button>
      </header>
      {tabs && tabs.length > 1 && (
        <nav className="nx-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={"nx-tab" + (t.id === tab ? " on" : "")}
              onClick={() => onTab?.(t.id)}
            >
              {t.label}
              {!!t.count && <span className="nx-badge">{t.count}</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="nx-dr-body">{children}</div>
      {footer && <footer className="nx-dr-foot">{footer}</footer>}
    </section>
  );
}

export function ActionFooter({ steps, step, verbs, input, inputAt, left }: {
  steps?: string[]; step?: number; verbs: Verb[]; input?: ReactNode;
  /** The verb the amount belongs to, by index; the input sits just before it. Default: the last. */
  inputAt?: number; left?: ReactNode;
}) {
  const at = inputAt ?? verbs.length - 1;
  return (
    <div className="nx-actions">
      {steps && (
        <ol className="nx-steps">
          {steps.map((s, i) => <li key={s} className={i === step ? "on" : i < (step ?? 0) ? "done" : undefined}>{s}</li>)}
        </ol>
      )}
      {left}
      <div className="nx-actions-right">
        {verbs.slice(0, at).map((v) => <VerbButton key={v.label} v={v} />)}
        {input}
        {verbs.slice(at).map((v) => <VerbButton key={v.label} v={v} />)}
      </div>
    </div>
  );
}

export function VerbButton({ v, small }: { v: Verb; small?: boolean }) {
  return (
    <button
      type="button"
      className={"nx-btn" + (v.primary ? " nx-primary" : "") + (v.danger ? " nx-danger" : "") + (small ? " nx-sm" : "")}
      disabled={!!v.disabled}
      title={v.disabled ?? (v.key ? keyTip(v.key) : undefined)}
      onClick={(e) => { e.stopPropagation(); v.run(); }}
    >
      {v.label}
      {v.key && <kbd>{v.key}</kbd>}
    </button>
  );
}

const keyTip = (k: string) => "Key " + k;
