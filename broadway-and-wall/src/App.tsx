import { useEffect } from "react";
import MapView from "@/map/MapView";
import TopBar from "@/ui/TopBar";
import RightPanel from "@/ui/RightPanel";
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
      <RightPanel />
      <Toast />
      {loadError && <div className="load-error">{loadError}</div>}
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
