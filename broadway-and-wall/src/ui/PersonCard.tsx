/**
 * Read-only person card — Phase 2 of The Principal.
 *
 * Your own attributes are visible (a person knows themselves). Nobody else's
 * true attrs are ever shown; rivals get name + age only. No behaviour.
 */
import type { GameState } from "@/engine/types";
import {
  ageYears, birthYear, ATTR_LABEL_PERSON, GENERAL_PERSON_ATTRS,
  type Person,
} from "@/engine/people";

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
        <div className="row">
          <span className="k">Principal</span>
          <span className="v">{person.name}</span>
        </div>
        <div className="row">
          <span className="k">Age</span>
          <span className="v">{age}</span>
        </div>
        <div className="row">
          <span className="k">Born</span>
          <span className="v">{birthYear(person)}</span>
        </div>
        {person.seat === "you" && (
          <div className="row">
            <span className="k">Firm</span>
            <span className="v">{game.firm?.name ?? "—"}</span>
          </div>
        )}
        {person.seat === "rival" && (
          <div className="row">
            <span className="k">Seat</span>
            <span className="v">Operating principal</span>
          </div>
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
                <div className="row" key={k}>
                  <span className="k">{ATTR_LABEL_PERSON[k] ?? k}</span>
                  <span className="v">
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
                  </span>
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
