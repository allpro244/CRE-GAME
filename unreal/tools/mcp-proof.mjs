// Phase 0 step 2: an agent spawns, moves and screenshots an actor through the
// editor's MCP server, with no human in the loop.
//   UE_MCP_URL=http://127.0.0.1:8001/mcp node unreal/tools/mcp-proof.mjs [outDir]   (8001 = the spike project)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, rpc } from "./mcp.mjs";

const out = process.argv[2] ?? "unreal/shots/phase0";
mkdirSync(out, { recursive: true });
const tool = async (toolset, name, args = {}) => {
  const r = await rpc("tools/call", { name: "call_tool", arguments: { toolset_name: toolset, tool_name: name, arguments: args } });
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (r.isError) throw new Error(`${name}: ${text}`);
  const img = r.content?.find((c) => c.type === "image");
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { json, text, img };
};
const SCENE = "editor_toolset.toolsets.scene.SceneTools", ACTOR = "editor_toolset.toolsets.actor.ActorTools", APP = "EditorToolset.EditorAppToolset";
const v = (x, y, z) => ({ x, y, z });
const cam = { location: v(-700, -500, 600), rotation: { pitch: -32, yaw: 38, roll: 0 } };

async function shot(name) {
  const r = await tool(APP, "CaptureViewport", { captureTransform: cam, bShowUI: false, annotations: { gridSpacing: 0, gridExtent: 0, gridHeight: 0, maxLabelDistance: 0, classFilter: null, maxLabels: 0 } });
  const data = r.img?.data ?? r.json?.returnValue?.image?.data;
  if (!data) throw new Error("no image in CaptureViewport reply: " + (r.text ?? "").slice(0, 300));
  const p = join(out, name + ".png");
  writeFileSync(p, Buffer.from(data, "base64"));
  console.log("saved", p);
}

await connect();
console.log("level:", (await tool(SCENE, "get_current_level")).text);
const spawned = await tool(SCENE, "add_to_scene_from_asset", {
  asset_path: "/Engine/BasicShapes/Cube.Cube", name: "AgentCube", parent: null,
  xform: { location: v(0, 0, 100), rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: v(1.5, 1.5, 1.5) },
});
const ref = spawned.json?.returnValue ?? spawned.json;
console.log("spawned:", JSON.stringify(ref));
await tool(APP, "SetCameraTransform", { transform: cam });
await shot("mcp-1-spawned");
await tool(ACTOR, "set_actor_transform", { actor: ref, xform: { location: v(250, 350, 75), rotation: { pitch: 0, yaw: 35, roll: 0 }, scale: v(1.5, 1.5, 1.5) }, worldspace: true });
console.log("after move:", (await tool(ACTOR, "get_actor_transform", { actor: ref })).text);
await shot("mcp-2-moved");
