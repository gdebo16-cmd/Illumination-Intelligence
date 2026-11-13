// GET /api/refract/workspaces — project folders copied into the Refract VM, and their snapshots.

import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/user";
import { listWorkspaces } from "@/lib/refract/workspace";

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please select a user profile first." }, { status: 401 });
  try {
    const workspaces = await listWorkspaces();
    return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't list workspaces.";
    // Don't leak host paths or SSH details; the workspace helper already returns friendly text.
    const safe = /virtual machine|workspace|SSH|isn't reachable|refused|identity/i.test(message)
      ? message
      : "Couldn't list workspaces in the virtual machine.";
    return NextResponse.json({ error: safe, workspaces: [] }, { status: 503 });
  }
}