// POST /api/refract/snapshots/restore - roll the Refract VM back to one of its snapshots. Body: { uuid }
// Powers the VM off first if needed (its current state is discarded) and starts it again if it was running.

import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/user";
import {
  cleanSnapshotId,
  getVmStatus,
  restoreSnapshot,
  UnknownSnapshotError,
  VmBusyError,
} from "@/lib/refract/vbox";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Please select a user profile first." }, { status: 401, headers: NO_STORE });
  }
  const body = await req.json().catch(() => ({}));
  const id = cleanSnapshotId(body?.uuid);
  if (!id) return NextResponse.json({ error: "That isn't a snapshot." }, { status: 400, headers: NO_STORE });

  let restartFailed = false;
  try {
    ({ restartFailed } = await restoreSnapshot(id));
  } catch (err) {
    if (err instanceof UnknownSnapshotError) {
      return NextResponse.json({ error: "That snapshot doesn't exist." }, { status: 400, headers: NO_STORE });
    }
    if (err instanceof VmBusyError) {
      return NextResponse.json({ error: "The virtual machine is busy. Try again in a moment." }, { status: 409, headers: NO_STORE });
    }
    // Don't send VBoxManage's own error text: it can include machine paths.
    return NextResponse.json({ error: "Couldn't restore the snapshot." }, { status: 503, headers: NO_STORE });
  }

  // The restore itself worked from here on, so always answer 200 with whatever status we can read.
  try {
    const status = await getVmStatus();
    return NextResponse.json({ ...status, restartFailed }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ restored: true, restartFailed, statusUnavailable: true }, { headers: NO_STORE });
  }
}
