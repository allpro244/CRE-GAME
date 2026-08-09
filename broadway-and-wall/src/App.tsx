import { useEffect } from "react";
import MapView from "@/map/MapView";
import TopBar from "@/ui/TopBar";
import RightPanel from "@/ui/RightPanel";
import StartMenu from "@/ui/StartMenu";
import { bootMenu, useStore } from "@/state/store";

export default function App() {
  const loadError = useStore((s) => s.loadError);
  // THE GAME NO LONGER STARTS ITSELF. Mounting used to generate a city and
  // drop the player into it; it now checks for a named save and stops, and the
  // start screen decides what gets built. MapView stays mounted throughout —
  // it waits on `city`, which is null until somebody breaks ground.
  const playing = useStore((s) => s.phase === "playing");
  useEffect(() => {
    void bootMenu();
  }, []);
  return (
    <div className="app">
      <MapView />
      {playing && <TopBar />}
      <RightPanel />
      <Toast />
      {!playing && <StartMenu />}
      {/* The start screen carries its own copy of this, because a city that
          would not build is the one error you can still act on from there. */}
      {loadError && playing && <div className="load-error">{loadError}</div>}
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className={"toast toast-" + toast.kind}>{toast.text}</div>;
}
