// POST /api/refract/power - start, stop or reset the Refract VM. Body: { action: "start" | "stop" | "reset" }
// Stop tries a clean ACPI shutdown first and powers off hard only if the guest doesn't finish in time.

import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/user";
import { cleanPowerAction } from "@/lib/refract/power";
import { getVmStatus, PowerStateError, powerVm, VmBusyError } from "@/lib/refract/vbox";

const NO_STORE = { "Cache-Control": "no-store" };

const FAILED: Record<string, string> = {
  start: "Couldn't start the virtual machine.",
  stop: "Couldn't stop the virtual machine.",
  reset: "Couldn't reset the virtual machine.",
};

export async function POST(req: Request) {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Please select a user profile first." }, { status: 401, headers: NO_STORE });
  }
  const body = await req.json().catch(() => ({}));
  const action = cleanPowerAction(body?.action);
  if (!action) return NextResponse.json({ error: "That isn't a power action." }, { status: 400, headers: NO_STORE });

  let forced = false;
  try {
    ({ forced } = await powerVm(action));
  } catch (err) {
    if (err instanceof PowerStateError) {
      return NextResponse.json(
        { error: "The virtual machine can't do that right now." },
        { status: 400, headers: NO_STORE },
      );
    }
    if (err instanceof VmBusyError) {
      return NextResponse.json({ error: "The virtual machine is busy. Try again in a moment." }, { status: 409, headers: NO_STORE });
    }
    // Don't send VBoxManage's own error text: it can include machine paths.
    return NextResponse.json({ error: FAILED[action] }, { status: 503, headers: NO_STORE });
  }

  try {
    const status = await getVmStatus();
    return NextResponse.json({ ...status, forced }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ done: true, forced, statusUnavailable: true }, { headers: NO_STORE });
  }
}