// Regenerates the repository table in README.md with fresh, baked-in values.
// Runs in GitHub Actions under GITHUB_TOKEN, so it never hits the shields.io
// shared GitHub-token pool — badges are static and can't render an error string.

import { readFile, writeFile } from "node:fs/promises";

const REPOS = [
  { label: "XrplCSharp", slug: "StaticBit-io/XrplCSharp" },
  { label: "notification.wpf", slug: "Platonenkov/notification.wpf" },
  { label: "StyledWindow.WPF", slug: "Platonenkov/StyledWindow.WPF" },
];

const COLOR = "5AA43A";
const LABEL_COLOR = "0d1117";
const README_PATH = "README.md";
const START = "<!--REPOS:START-->";
const END = "<!--REPOS:END-->";

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

function langBadge(name, percent) {
  return `https://img.shields.io/badge/${shieldEscape(name)}-${shieldEscape(percent)}-${COLOR}?style=flat-square&labelColor=${LABEL_COLOR}`;
}

function updatedBadge(date) {
  return `https://img.shields.io/badge/${shieldEscape(date)}-${COLOR}?style=flat-square`;
}

function formatDate(iso) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function topLanguage(languages) {
  const entries = Object.entries(languages);
  if (entries.length === 0) return { name: "n/a", percent: "0%" };
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const [name, bytes] = entries.sort((a, b) => b[1] - a[1])[0];
  const percent = `${((bytes / total) * 100).toFixed(1)}%`;
  return { name: name.toLowerCase(), percent };
}

async function buildRow({ label, slug }) {
  const [info, languages] = await Promise.all([gh(`/repos/${slug}`), gh(`/repos/${slug}/languages`)]);
  const lang = topLanguage(languages);
  const stars = `![stars](${starsBadge(info.stargazers_count)})`;
  const langCell = `![lang](${langBadge(lang.name, lang.percent)})`;
  const updated = `![updated](${updatedBadge(formatDate(info.pushed_at))})`;
  return `| [${label}](https://github.com/${slug}) | ${stars} | ${langCell} | ${updated} |`;
}

async function main() {
  const rows = await Promise.all(REPOS.map(buildRow));
  const table = ["| Repo | Stars | Lang | Updated |", "|:-----|:-----:|:----:|:-------:|", ...rows].join("\n");
  const block = `${START}\n${table}\n${END}`;

  const readme = await readFile(README_PATH, "utf8");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!pattern.test(readme)) {
    throw new Error(`Markers ${START} ... ${END} not found in ${README_PATH}`);
  }
  const updated = readme.replace(pattern, block);

  if (updated === readme) {
    console.log("No changes.");
    return;
  }
  await writeFile(README_PATH, updated);
  console.log("README repo table updated.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
