// POST /api/refract/snapshots - take a snapshot of the Refract VM. Body: { name }

import { NextResponse } from "next/server";
import { getCurrentUserId, noProfile } from "@/lib/user";
import { cleanSnapshotName, getVmStatus, takeSnapshot } from "@/lib/refract/vbox";

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const name = cleanSnapshotName(body.name);
  if (!name) return NextResponse.json({ error: "Please give the snapshot a name." }, { status: 400 });
  try {
    const before = await getVmStatus();
    await takeSnapshot(name, before.state === "running");
    const status = await getVmStatus();
    return NextResponse.json(status, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't take a snapshot." }, { status: 503 });
  }
}
