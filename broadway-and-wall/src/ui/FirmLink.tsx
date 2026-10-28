import { useStore } from "@/state/store";

const LINK: React.CSSProperties = {
  background: "none", border: "none", padding: 0, margin: 0,
  font: "inherit", color: "inherit", cursor: "pointer",
  textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2,
};

/**
 * A buyer's name you can click. Every bidder is a firm on the street, so the
 * name opens that firm's page on Players. A name the roster does not know
 * (an old save) prints as plain text.
 */
export function FirmLink({ name, id }: { name: string; id?: string }) {
  const firmId = useStore((s) => {
    const rivals = s.game?.rivals ?? [];
    return (id ? rivals.find((r) => r.id === id) : rivals.find((r) => r.name === name))?.id;
  });
  if (!firmId) return <>{name}</>;
  return (
    <button type="button" style={LINK} title={`Open ${name}'s page`}
      onClick={(e) => { e.stopPropagation(); useStore.getState().openFirm(firmId); }}>
      {name}
    </button>
  );
}
