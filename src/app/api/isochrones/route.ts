import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  try {
    const body = await readFile(
      join(process.cwd(), "data/generated/isochrones.geojson"),
      "utf8",
    );
    return new Response(body, {
      headers: {
        "content-type": "application/geo+json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Isochrone data is missing. Run npm run build:isochrones." },
      { status: 404 },
    );
  }
}
