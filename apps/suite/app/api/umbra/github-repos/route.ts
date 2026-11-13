// GET /api/umbra/github-repos — the user's GitHub repos, marked if already copied into Refract.

import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/user";
import { listHubRepos } from "@/lib/github/repos";
import { listWorkspaces } from "@/lib/refract/workspace";

function normalize(url: string): string {
  return url.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
}

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please select a user profile first." }, { status: 401 });

  try {
    const repos = await listHubRepos();
    let workspaces: Awaited<ReturnType<typeof listWorkspaces>> = [];
    try {
      workspaces = await listWorkspaces();
    } catch {
      // VM off or SSH failed: still return the GitHub list, just without "in Refract".
    }

    const listed = repos.map((repo) => {
      const match = workspaces.find((w) => {
        if (w.git && (normalize(w.git) === normalize(repo.url) || (repo.htmlUrl && normalize(w.git) === normalize(repo.htmlUrl)))) {
          return true;
        }
        return w.name === repo.name;
      });
      return {
        name: repo.name,
        fullName: repo.fullName,
        url: repo.url,
        htmlUrl: repo.htmlUrl,
        private: repo.private,
        fork: repo.fork,
        description: repo.description,
        inRefract: Boolean(match),
        workspace: match?.name ?? null,
      };
    });

    return NextResponse.json({ repos: listed }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load your GitHub repos.";
    const safe = /GitHub|repos|sign in|wait a bit/i.test(message)
      ? message
      : "Couldn't load your GitHub repos.";
    return NextResponse.json({ error: safe, repos: [] }, { status: 502 });
  }
}
