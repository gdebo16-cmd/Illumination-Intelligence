// GET /api/refract/status - how the Refract virtual machine is doing (on, off, snapshots).

import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/user";
import { getVmStatus } from "@/lib/refract/vbox";

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please select a user profile first." }, { status: 401 });
  try {
    const status = await getVmStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Don't send VBoxManage's own error text: it can include machine paths.
    return NextResponse.json({ error: "Couldn't reach the virtual machine." }, { status: 503 });
  }
}
