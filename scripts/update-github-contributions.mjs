import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  contributionTotal,
  normalizeContributionWeeks,
  renderContributionCells
} from './github-contributions-lib.mjs';

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_LOGIN || 'DamianvdB';
const root = process.cwd();

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

const query = `
  query Contributions($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            firstDay
            contributionDays {
              date
              contributionCount
              contributionLevel
              weekday
            }
          }
        }
      }
    }
  }
`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'damianvdb.github.io contribution updater',
    'X-GitHub-Api-Version': '2022-11-28'
  },
  body: JSON.stringify({ query, variables: { login } })
});

if (!response.ok) {
  throw new Error(`GitHub returned HTTP ${response.status}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(`GitHub GraphQL failed: ${payload.errors.map(error => error.type || 'unknown').join(', ')}`);
}

const allWeeks = payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
const weeks = normalizeContributionWeeks(allWeeks);
const totalContributions = contributionTotal(weeks);
const snapshot = {
  login,
  generatedAt: new Date().toISOString(),
  totalContributions,
  weeks
};

const dataDirectory = path.join(root, 'data');
await mkdir(dataDirectory, { recursive: true });
await writeFile(
  path.join(dataDirectory, 'github-contributions.json'),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  'utf8'
);

const cells = renderContributionCells(weeks);

const indexPath = path.join(root, 'index.html');
let html = await readFile(indexPath, 'utf8');
const countPattern = /(<strong data-github-contribution-total>)[\d,]+(<\/strong>)/;
const calendarPattern = /(<!-- github-contributions:start -->)[\s\S]*?(<!-- github-contributions:end -->)/;
if (!countPattern.test(html) || !calendarPattern.test(html)) {
  throw new Error('GitHub contribution placeholders are missing from index.html');
}

html = html
  .replace(countPattern, `$1${totalContributions.toLocaleString('en-US')}$2`)
  .replace(/("dateModified": ")\d{4}-\d{2}-\d{2}("[,])/, `$1${snapshot.generatedAt.slice(0, 10)}$2`)
  .replace(calendarPattern, `$1\n${cells}\n          $2`);
await writeFile(indexPath, html, 'utf8');

const sitemapPath = path.join(root, 'sitemap.xml');
const sitemap = await readFile(sitemapPath, 'utf8');
await writeFile(
  sitemapPath,
  sitemap.replace(/(<lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/, `$1${snapshot.generatedAt.slice(0, 10)}$2`),
  'utf8'
);

console.log(`Rendered ${weeks.length} weeks of public GitHub contributions for ${login}.`);
