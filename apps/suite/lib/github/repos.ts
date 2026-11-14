// Live list of the user's GitHub repositories. Fetched from GitHub on each
// request (no long cache), so a newly created repo shows up after a refresh.
// If GITHUB_TOKEN is set, private repos and ones you collaborate on are included.
// Never log the token.

import "server-only";

export const GITHUB_USER = process.env.GITHUB_LOGIN ?? "gdebo16-cmd";

export type HubRepo = {
  name: string;
  fullName: string;
  url: string;
  htmlUrl: string;
  private: boolean;
  fork: boolean;
  description: string | null;
};

function nextPage(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (!/rel="next"/i.test(part)) continue;
    const m = part.match(/<([^>]+)>/);
    if (m) return m[1];
  }
  return null;
}

function tidyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.hash = "";
    return u.toString().replace(/\.git\/?$/i, "").replace(/\/$/, "") + ".git";
  } catch {
    return raw;
  }
}

export async function listHubRepos(): Promise<HubRepo[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Illumination-Intelligence",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let page: string | null = token
    ? "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
    : `https://api.github.com/users/${encodeURIComponent(GITHUB_USER)}/repos?per_page=100&sort=updated&type=owner`;

  const repos: HubRepo[] = [];
  const seen = new Set<string>();
  while (page) {
    const res = await fetch(page, { headers, cache: "no-store" });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error("GitHub asked us to wait a bit. Try again in a minute.");
      }
      if (res.status === 401) {
        throw new Error("Couldn't sign in to GitHub to list your repos.");
      }
      throw new Error("Couldn't load your GitHub repos.");
    }
    const rows = (await res.json()) as Array<{
      name?: string;
      full_name?: string;
      clone_url?: string;
      html_url?: string;
      private?: boolean;
      fork?: boolean;
      description?: string | null;
    }>;
    for (const row of rows) {
      const name = typeof row.name === "string" ? row.name : "";
      const htmlUrl = typeof row.html_url === "string" ? row.html_url : "";
      const clone = typeof row.clone_url === "string" ? tidyUrl(row.clone_url) : htmlUrl ? tidyUrl(htmlUrl) : "";
      if (!name || !clone || seen.has(clone)) continue;
      seen.add(clone);
      repos.push({
        name,
        fullName: typeof row.full_name === "string" ? row.full_name : name,
        url: clone,
        htmlUrl,
        private: Boolean(row.private),
        fork: Boolean(row.fork),
        description: typeof row.description === "string" ? row.description : null,
      });
    }
    page = nextPage(res.headers.get("link"));
  }
  return repos;
}
