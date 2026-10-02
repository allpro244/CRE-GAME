/**
 * Person card — principal display. No age, no birth year, no death clock and
 * no estate: nobody in this game ages or dies (ECONOMY.md "No age, no mortality").
 *
 * Your own attributes are visible. Nobody else's true attrs are ever shown.
 * Markup matches DebtPage `Row` / `.grid` (sibling `.k` + `.v`).
 */
import type { GameState } from "@/engine/types";
import {
  ATTR_LABEL_PERSON, GENERAL_PERSON_ATTRS, topCareerLines,
  type Person,
} from "@/engine/people";
import { personProgress } from "@/engine/firmCapital";

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
  const prog = personProgress(person);

  return (
    <div className="page-section" style={{ marginTop: 8 }}>
      <div className="page-section-head">{title ?? person.name}</div>
      <div className="grid" style={{ margin: "6px 0" }}>
        <Row k="Principal" v={person.name} />
        {person.seat === "you" && (
          <Row k="Firm" v={game.firm?.name ?? "—"} />
        )}
        {person.seat === "rival" && (
          <Row k="Seat" v="Operating principal" />
        )}
        {prog.careerYears > 0 && (
          <Row k="Career" v={`${prog.careerYears.toFixed(1)} years operating exposure`} />
        )}
        {topCareerLines(person.career).length > 0 && (
          <Row k="Knows" v={topCareerLines(person.career).join(" · ")} />
        )}
      </div>
      {showAttrs && person.seat === "you" ? (
        <>
          <div className="hint" style={{ marginTop: 4 }}>
            Deal sense, Bandwidth, Rigor, Access — temperament, not a skill build.
            Career (“Knows …”) is what you have actually done. Nobody else's true
            ability is a number on a screen; you narrow a read by dealing with them.
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

/** Compact one-liner for tables: the principal's name. */
export function personLine(person: Person | undefined): string {
  return person ? person.name : "—";
}
