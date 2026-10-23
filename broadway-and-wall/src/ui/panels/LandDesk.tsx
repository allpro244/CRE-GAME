// THE LAND DEVELOPMENT DESK (region map): a farm tract you own, laid out as a
// subdivision. The desk is ui/next/PlatDesk.tsx — four choices (lot size,
// street pattern, amenities, the A&D loan), the plat drawn read-only, and one
// commit. The classic panel shows the commit on the desk; the new shell's
// building file puts it in the footer.
import PlatDesk from "@/ui/next/PlatDesk";

export default function LandDesk({ bbl }: { bbl: string }) {
  return <PlatDesk bbl={bbl} commit />;
}
