import { useEffect, useRef, useState } from "react";

/**
 * WHICH VIEW OF A DESK A LINK FROM SOMEWHERE ELSE WANTED.
 *
 * A page's view (Players → The street, Markets → Office, Tape → Prints) is
 * state inside the page component, and the component does not exist until
 * `setPage` mounts it — so a caller cannot set the view directly. This is the
 * handoff: the link drops a view name against a page, the page reads it in its
 * `useState` initialiser on first render, and an effect clears it once that
 * render has committed.
 *
 * READING AND CLEARING ARE TWO STEPS because of StrictMode, which runs a lazy
 * `useState` initialiser twice: a read that cleared would hand the view to the
 * first call and `null` to the second, the one React keeps.
 *
 * A link into a page that is ALREADY OPEN would otherwise do nothing — the
 * page does not remount — so an open page also subscribes and switches when a
 * handoff lands for it.
 *
 * It is one-shot so a deep link does not permanently change a page's home, and
 * module scope because it is a fact about this click in this browser, not
 * something that belongs in a save.
 */
const pending: Record<string, string> = {};
const listeners = new Set<() => void>();

export function openViewOn(page: string, view: string) {
  pending[page] = view;
  for (const l of listeners) l();
}

export function useDeskView<T extends string>(page: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const ok = useRef(allowed);
  ok.current = allowed;
  const [view, setView] = useState<T>(() => {
    const p = pending[page];
    return p && allowed.includes(p as T) ? (p as T) : fallback;
  });
  useEffect(() => {
    delete pending[page];
    const on = () => {
      const p = pending[page];
      if (p === undefined) return;
      delete pending[page];
      if (ok.current.includes(p as T)) setView(p as T);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, [page]);
  return [view, setView];
}
