// The one-shot Research tab handoff (see the note in ui/panels/shared.tsx).
// In its own module so the store can set it from an inbox route without
// importing shared.tsx, which imports the store.
export let pendingRTab: string | null = null;
export const openResearchOn = (tab: string) => { pendingRTab = tab; };
/** Clear after ResearchPage reads the handoff (cannot assign through an import binding). */
export const clearPendingRTab = () => { pendingRTab = null; };
