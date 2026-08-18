// COMMAND PALETTE (Cmd/Ctrl-K) — jump to any address, tenant, firm, lender,
// loan or desk by name. Renders nothing until the full palette lands; the
// hotkey in GamePanels toggles `paletteOpen` either way.
import { useStore } from "@/state/store";

export default function Palette() {
  const open = useStore((s) => s.paletteOpen);
  if (!open) return null;
  return null;
}
