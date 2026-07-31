// Minimal PMTiles v3 writer (spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3).
// tippecanoe isn't assumed to exist on the build machine; this plus
// geojson-vt + vt-pbf produces the same artifact for our tile counts
// (a few hundred tiles over one community district, root directory only).
import { gzipSync } from "node:zlib";

// ---- Hilbert tile ids ---------------------------------------------------
function rotate(n, xy, rx, ry) {
  if (ry === 0) {
    if (rx === 1) { xy[0] = n - 1 - xy[0]; xy[1] = n - 1 - xy[1]; }
    const t = xy[0]; xy[0] = xy[1]; xy[1] = t;
  }
}
export function zxyToTileId(z, x, y) {
  // number of tiles in all zoom levels below z: (4^z - 1) / 3
  let acc = 0;
  for (let i = 0; i < z; i++) acc += Math.pow(4, i);
  const n = Math.pow(2, z);
  let rx, ry, d = 0;
  const xy = [x, y];
  for (let s = n / 2; s >= 1; s /= 2) {
    rx = (xy[0] & s) > 0 ? 1 : 0;
    ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return acc + d;
}

// ---- varint helpers -----------------------------------------------------
class ByteWriter {
  constructor() { this.chunks = []; }
  varint(v) {
    // v may exceed 2^32 (tile ids at deep zooms) — split high/low
    const bytes = [];
    while (v >= 0x80) { bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    bytes.push(v);
    this.chunks.push(Buffer.from(bytes));
  }
  buffer() { return Buffer.concat(this.chunks); }
}

function serializeDirectory(entries) {
  // entries: [{tileId, offset, length, runLength}] sorted by tileId
  const w = new ByteWriter();
  w.varint(entries.length);
  let last = 0;
  for (const e of entries) { w.varint(e.tileId - last); last = e.tileId; }
  for (const e of entries) w.varint(e.runLength);
  for (const e of entries) w.varint(e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) w.varint(0);
    else w.varint(e.offset + 1);
  }
  return w.buffer();
}

function u64(buf, pos, v) { buf.writeBigUInt64LE(BigInt(v), pos); }

/**
 * Build a PMTiles v3 archive.
 * tiles: Map keyed "z/x/y" -> Buffer (uncompressed MVT bytes)
 * meta: { minZoom, maxZoom, bounds: [w,s,e,n], center: [lon,lat,zoom], layers: vector_layers json }
 */
export function buildPMTiles(tiles, meta) {
  const entries = [];
  const contents = [];
  const seen = new Map(); // dedupe identical tile payloads
  let offset = 0;
  const keyed = [...tiles.entries()].map(([k, buf]) => {
    const [z, x, y] = k.split("/").map(Number);
    return { tileId: zxyToTileId(z, x, y), buf };
  }).sort((a, b) => a.tileId - b.tileId);

  for (const { tileId, buf } of keyed) {
    const gz = gzipSync(buf, { level: 9 });
    const hash = gz.toString("base64").slice(0, 64) + ":" + gz.length;
    if (seen.has(hash)) {
      const prev = seen.get(hash);
      entries.push({ tileId, offset: prev.offset, length: prev.length, runLength: 1 });
    } else {
      entries.push({ tileId, offset, length: gz.length, runLength: 1 });
      seen.set(hash, { offset, length: gz.length });
      contents.push(gz);
      offset += gz.length;
    }
  }

  const tileData = Buffer.concat(contents);
  const rootDir = gzipSync(serializeDirectory(entries), { level: 9 });
  const metadata = gzipSync(Buffer.from(JSON.stringify({
    name: meta.name ?? "broadway-and-wall",
    format: "pbf",
    vector_layers: meta.layers ?? [],
  })), { level: 9 });

  const HEADER = 127;
  const rootOff = HEADER;
  const metaOff = rootOff + rootDir.length;
  const leafOff = metaOff + metadata.length;
  const dataOff = leafOff; // no leaf directories
  const header = Buffer.alloc(HEADER);
  header.write("PMTiles", 0, "ascii");
  header.writeUInt8(3, 7);
  u64(header, 8, rootOff); u64(header, 16, rootDir.length);
  u64(header, 24, metaOff); u64(header, 32, metadata.length);
  u64(header, 40, leafOff); u64(header, 48, 0);
  u64(header, 56, dataOff); u64(header, 64, tileData.length);
  u64(header, 72, entries.length);   // addressed tiles
  u64(header, 80, entries.length);   // tile entries
  u64(header, 88, contents.length);  // tile contents
  header.writeUInt8(1, 96);  // clustered
  header.writeUInt8(2, 97);  // internal compression: gzip
  header.writeUInt8(2, 98);  // tile compression: gzip
  header.writeUInt8(1, 99);  // tile type: mvt
  header.writeUInt8(meta.minZoom, 100);
  header.writeUInt8(meta.maxZoom, 101);
  const [w, s, e, n] = meta.bounds;
  header.writeInt32LE(Math.round(w * 1e7), 102);
  header.writeInt32LE(Math.round(s * 1e7), 106);
  header.writeInt32LE(Math.round(e * 1e7), 110);
  header.writeInt32LE(Math.round(n * 1e7), 114);
  header.writeUInt8(Math.round(meta.center[2]), 118);
  header.writeInt32LE(Math.round(meta.center[0] * 1e7), 119);
  header.writeInt32LE(Math.round(meta.center[1] * 1e7), 123);

  return Buffer.concat([header, rootDir, metadata, tileData]);
}
