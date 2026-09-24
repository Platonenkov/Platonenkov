// Regenerates the repository table and the NuGet summary in README.md with
// fresh, baked-in values. Runs in GitHub Actions under GITHUB_TOKEN, so it never
// hits the shields.io shared GitHub-token pool — badges are static and can't
// render an error string.
//
// Downloads come from the NuGet search API. Each repository maps to its main
// package only: dependency packages (codecs pulled in by Xrpl) are left out of the
// per-row figure, since adding them would count the same installs several times.

import { readFile, writeFile } from "node:fs/promises";

const REPOS = [
  { label: "XrplCSharp", slug: "StaticBit-io/XrplCSharp", nuget: "Xrpl" },
  { label: "notification.wpf", slug: "Platonenkov/notification.wpf", nuget: "Notification.Wpf" },
  { label: "StyledWindow.WPF", slug: "Platonenkov/StyledWindow.WPF", nuget: "StyledWindow.WPF" },
];

const NUGET_OWNER = "APlatonenkov";
const NUGET_INDEX = "https://api.nuget.org/v3/index.json";

const COLOR = "5AA43A";
const LABEL_COLOR = "0d1117";
const README_PATH = "README.md";
const START = "<!--REPOS:START-->";
const END = "<!--REPOS:END-->";
const NUGET_START = "<!--NUGET:START-->";
const NUGET_END = "<!--NUGET:END-->";

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "readme-repo-updater",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function gh(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} -> ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "readme-repo-updater" } });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// Resolves the search endpoint from the service index instead of hard-coding a
// regional host, then pulls every package of the owner in one request.
async function nugetPackages() {
  const index = await getJson(NUGET_INDEX);
  const service = index.resources.find((r) => r["@type"] === "SearchQueryService");
  if (!service) throw new Error("NuGet SearchQueryService not found in service index");
  const url = `${service["@id"]}?q=owner:${NUGET_OWNER}&take=1000&prerelease=true&semVerLevel=2.0.0`;
  const result = await getJson(url);
  if (result.data.length < result.totalHits) {
    throw new Error(`NuGet returned ${result.data.length} of ${result.totalHits} packages`);
  }
  return new Map(result.data.map((p) => [p.id.toLowerCase(), p.totalDownloads]));
}

// Rounds down, so the badge never claims more than NuGet reports: 829602 -> 829K+.
function compact(n) {
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M+`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K+`;
  return String(n);
}

// shields.io static-badge escaping for a single path segment.
function shieldEscape(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")
    .replace(/&/g, "%26")
    .replace(/-/g, "--")
    .replace(/_/g, "__")
    .replace(/ /g, "%20");
}

function starsBadge(stars) {
  return `https://img.shields.io/badge/${shieldEscape(stars)}-${COLOR}?style=flat-square`;
}

function downloadsBadge(count) {
  return `https://img.shields.io/badge/${shieldEscape(count)}-${COLOR}?style=flat-square`;
}

function nugetSummaryBadge(packages, downloads) {
  const message = `${packages} packages · ${downloads} downloads`;
  return `https://img.shields.io/badge/NuGet-${shieldEscape(message)}-004880?style=flat-square&logo=nuget&logoColor=white`;
}

function updatedBadge(date) {
  return `https://img.shields.io/badge/${shieldEscape(date)}-${COLOR}?style=flat-square`;
}

function formatDate(iso) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function buildRow({ label, slug, nuget }, downloadsById) {
  const info = await gh(`/repos/${slug}`);
  const stars = `![stars](${starsBadge(info.stargazers_count)})`;
  const count = nuget ? downloadsById.get(nuget.toLowerCase()) : undefined;
  const downloads = count === undefined ? "-" : `![downloads](${downloadsBadge(compact(count))})`;
  const updated = `![updated](${updatedBadge(formatDate(info.pushed_at))})`;
  return `| [${label}](https://github.com/${slug}) | ${stars} | ${downloads} | ${updated} |`;
}

function replaceBlock(text, start, end, body) {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(text)) {
    throw new Error(`Markers ${start} ... ${end} not found in ${README_PATH}`);
  }
  return text.replace(pattern, `${start}\n${body}\n${end}`);
}

async function main() {
  const downloadsById = await nugetPackages();
  const rows = await Promise.all(REPOS.map((repo) => buildRow(repo, downloadsById)));
  const table = ["| Repo | Stars | Downloads | Updated |", "|:-----|:-----:|:---------:|:-------:|", ...rows].join("\n");

  const total = [...downloadsById.values()].reduce((sum, n) => sum + n, 0);
  const summary = `[![NuGet](${nugetSummaryBadge(downloadsById.size, compact(total))})](https://www.nuget.org/profiles/${NUGET_OWNER})`;

  const readme = await readFile(README_PATH, "utf8");
  let updated = replaceBlock(readme, START, END, table);
  updated = replaceBlock(updated, NUGET_START, NUGET_END, summary);

  if (updated === readme) {
    console.log("No changes.");
    return;
  }
  await writeFile(README_PATH, updated);
  console.log(`README updated: ${downloadsById.size} packages, ${total} downloads.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
