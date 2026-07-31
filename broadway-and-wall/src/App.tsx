import { useEffect } from "react";
import MapView from "@/map/MapView";
import TopBar from "@/ui/TopBar";
import ParcelPanel from "@/ui/ParcelPanel";
import { loadData, useStore } from "@/state/store";

export default function App() {
  const loadError = useStore((s) => s.loadError);
  useEffect(() => {
    loadData();
  }, []);
  return (
    <div className="app">
      <MapView />
      <TopBar />
      <ParcelPanel />
      {loadError && <div className="load-error">{loadError}</div>}
    </div>
  );
}
