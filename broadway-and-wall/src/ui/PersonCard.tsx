/**
 * Read-only person card — Phase 2 of The Principal.
 *
 * Your own attributes are visible (a person knows themselves). Nobody else's
 * true attrs are ever shown; rivals get name + age only. No behaviour.
 *
 * Markup matches DebtPage `Row` / `.grid` (sibling `.k` + `.v`), not a nested
 * `.row` wrapper — a second layout would drift from the street table.
 */
import type { GameState } from "@/engine/types";
import {
  ageYears, birthYear, ATTR_LABEL_PERSON, GENERAL_PERSON_ATTRS,
  type Person,
} from "@/engine/people";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
    </>
  );
}

export function PersonCard({
  person,
  game,
  showAttrs = false,
  title,
}: {
  person: Person;
  game: GameState;
  /** True only for seat "you". */
  showAttrs?: boolean;
  title?: string;
}) {
  const age = ageYears(person, game.month);
  return (
    <div className="page-section" style={{ marginTop: 8 }}>
      <div className="page-section-head">{title ?? person.name}</div>
      <div className="grid" style={{ margin: "6px 0" }}>
        <Row k="Principal" v={person.name} />
        <Row k="Age" v={String(age)} />
        <Row k="Born" v={String(birthYear(person))} />
        {person.seat === "you" && (
          <Row k="Firm" v={game.firm?.name ?? "—"} />
        )}
        {person.seat === "rival" && (
          <Row k="Seat" v="Operating principal" />
        )}
      </div>
      {showAttrs && person.seat === "you" ? (
        <>
          <div className="hint" style={{ marginTop: 4 }}>
            You know your own measure. Nobody else's true ability is ever a number on a screen —
            you narrow a read by dealing with them.
          </div>
          <div className="grid" style={{ marginTop: 8 }}>
            {GENERAL_PERSON_ATTRS.map((k) => {
              const v = person.attrs[k] ?? 50;
              return (
                <div key={k} style={{ display: "contents" }}>
                  <div className="k">{ATTR_LABEL_PERSON[k] ?? k}</div>
                  <div className="v mono">
                    <span style={{
                      display: "inline-block", width: 120, height: 6,
                      background: "rgba(43,37,26,0.12)", borderRadius: 2, verticalAlign: "middle",
                      marginRight: 8,
                    }}>
                      <span style={{
                        display: "block", height: "100%", width: `${v}%`,
                        background: "rgba(43,37,26,0.55)", borderRadius: 2,
                      }} />
                    </span>
                    {v}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : person.seat !== "you" ? (
        <div className="hint">
          What they are actually worth is something you will find out by dealing with them —
          not from a card.
        </div>
      ) : null}
    </div>
  );
}

/** Compact one-liner for tables. */
export function personAgeLine(person: Person | undefined, month: number): string {
  if (!person) return "—";
  return `${person.name}, ${ageYears(person, month)}`;
}
