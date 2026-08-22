declare module "@/map/skylineSig.mjs" {
  export type SkylineItem = {
    bbl: string;
    cls: string;
    heightM: number;
    floors: number;
    construction: boolean;
    fresh?: boolean;
    styleOverride?: number;
    cov?: number;
    year?: number;
  };

  export function playerSkylineLayerSig(items: SkylineItem[], construction: boolean): string;
}
