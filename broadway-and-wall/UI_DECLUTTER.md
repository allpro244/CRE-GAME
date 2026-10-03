# UI declutter — what changed and the rules it leaves behind

Structure, not styling. Colours, type and radii still come from
`src/ui/system/*` (the design system); the only new stylesheet is
`src/ui/declutter.css`, which says where the new pieces sit and reads every
value from the design-system tokens. A restyle of the design system carries
through without touching it.

## The rules

1. **One home per figure.** Each number has one desk that owns it. Anywhere else
   it gets a link to that desk (`className="linkish"`), not a copy. If two
   screens need the same number, they call the same function. Two different
   quantities never share a label. For example, the top bar's **CF / yr** is the
   firm's cash flow, while Portfolio's **Property CF / mo** covers the buildings
   alone.
2. **Desks, not doors.** `src/ui/desks.ts` is the only list of desks and their
   tabs. Everything that names a room reads from it:
   - the side rail
   - the desk tab strip
   - the digit keys
   - the `?` shortcut card
   - the ⌘K palette
   - the Back button

   Add a page by adding a tab there. A tab with `when` appears only while it has
   something on it (Notes, for example).
3. **Every desk has the same shape.** It opens with the strip (a few tiles), then
   what wants you (letters, alarms), then the detail. Settings-like detail goes
   in a `Fold` (`src/ui/Fold.tsx`). A Fold is a section head with a one-line
   summary, and it remembers whether it was open per viewer.
4. **The map card is a glance.** It shows the overview, plus the buy desk on
   buildings you don't own. Doors lead into the property file's tabs. **Full OM**
   (remembered) brings the whole file back onto the map.
5. **Map controls live on the map.** Lenses and the City / Book / Cranes
   emphasis sit in `MapControls` along the foot of the map.

## Measured on a 66-month, eight-building book (1600×900)

| | before | after |
|---|---|---|
| Side-rail entries | 14 desks, 6 lenses, 4 readouts, 4 campaign | 6 desks, one tool row |
| Top-bar readouts | 9 | 6 + Line / Book only when they matter |
| Owned-building map card | 6,087 px tall, 48 buttons | 1,342 px, 16 buttons |
| Portfolio page | 3,111 px, 10 tiles | 1,870 px, 6 tiles |
| Books page | 3,467 px | 2,348 px |
| Maturity wall copies | Portfolio + Debt ladder + Deals Watch | Debt (now with construction loans) |
| Lease-roll copies | Portfolio + Leasing + Deals Watch | Leasing |
