/**
 * ONE OCEAN, ONE COLOUR — and one leaf module, so both renderers can read it.
 *
 * Two renderers draw this harbour. MapLibre paints a flat fill under
 * everything, and the Three layer paints a living sea over the top of it out to
 * the edge of its own mesh; past that edge the fill shows raw. So the two have
 * to agree on a colour or the world ends in a visible band — and until now they
 * agreed by having been "matched by eye", which is the same quantity with two
 * different answers written in two files. WATER_FRAG's far field now lands on
 * this exact value, so the join cannot drift apart again.
 *
 * IT LIVES ALONE FOR A REASON. It started life in `style.ts` next to the
 * background layer that uses it, which is the obvious home and the wrong one:
 * `style.ts` reads `import.meta.env` at module scope, so importing it from
 * ThreeBuildings dragged a Vite-only global into every plain-node bundle that
 * touches the render module — `pnpm plate` died on
 * "Cannot read properties of undefined (reading 'VITE_BASEMAP_STYLE')" the
 * first time it ran. A shared fact about the world should not carry a build
 * system with it.
 *
 * The value is the one that was already there: the open-water tone the sea
 * shader's own `deep` arrives at once the air has taken its cut.
 */
export const OPEN_SEA = "#33719c";
