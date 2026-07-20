#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_API =
  'https://data.ca.gov/api/3/action/package_show?id=california-grants-portal';
const DATASTORE_API = 'https://data.ca.gov/api/3/action/datastore_search';
const PAGE_SIZE = 500;
const UPCOMING_WINDOW_DAYS = 90;

// These names were verified against the live DataStore response on July 19, 2026.
const REQUIRED_FIELDS = [
  'PortalID',
  'GrantID',
  'Status',
  'AgencyDept',
  'Title',
  'Categories',
  'Purpose',
  'Description',
  'ApplicantType',
  'Geography',
  'EstAmounts',
  'OpenDate',
  'ApplicationDeadline',
  'ElecSubmission',
  'GrantURL',
  'AgencyURL',
];

const CALIFORNIA_COUNTIES = [
  'Alameda', 'Alpine', 'Amador', 'Butte', 'Calaveras', 'Colusa', 'Contra Costa',
  'Del Norte', 'El Dorado', 'Fresno', 'Glenn', 'Humboldt', 'Imperial', 'Inyo',
  'Kern', 'Kings', 'Lake', 'Lassen', 'Los Angeles', 'Madera', 'Marin', 'Mariposa',
  'Mendocino', 'Merced', 'Modoc', 'Mono', 'Monterey', 'Napa', 'Nevada', 'Orange',
  'Placer', 'Plumas', 'Riverside', 'Sacramento', 'San Benito', 'San Bernardino',
  'San Diego', 'San Francisco', 'San Joaquin', 'San Luis Obispo', 'San Mateo',
  'Santa Barbara', 'Santa Clara', 'Santa Cruz', 'Shasta', 'Sierra', 'Siskiyou',
  'Solano', 'Sonoma', 'Stanislaus', 'Sutter', 'Tehama', 'Trinity', 'Tulare',
  'Tuolumne', 'Ventura', 'Yolo', 'Yuba',
];

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateSummary(value, maxLength = 360) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1);
  const sentenceBreak = Math.max(
    shortened.lastIndexOf('. '),
    shortened.lastIndexOf('! '),
    shortened.lastIndexOf('? '),
  );
  if (sentenceBreak >= Math.floor(maxLength * 0.58)) {
    return shortened.slice(0, sentenceBreak + 1);
  }
  const wordBreak = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, wordBreak > 0 ? wordBreak : maxLength).trim()}…`;
}

function toDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function pacificDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function splitList(value) {
  return [...new Set(
    cleanText(value)
      .split(/\s*;\s*/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function mapApplicantTypes(value) {
  const rawTypes = splitList(value);
  const mapped = new Set();

  for (const rawType of rawTypes) {
    const type = rawType.toLowerCase();
    if (type.includes('business')) mapped.add('business');
    else if (type.includes('nonprofit') || type.includes('non-profit')) mapped.add('nonprofit');
    else if (type.includes('individual')) mapped.add('individual');
    else if (type.includes('tribal')) mapped.add('tribal');
    else if (type.includes('public') || type.includes('government')) mapped.add('public agency');
    else mapped.add('other');
  }

  return mapped.size ? [...mapped] : ['other'];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCounties(value) {
  const geography = cleanText(value);
  const counties = CALIFORNIA_COUNTIES.filter((county) => {
    const pattern = new RegExp(`\\b${escapeRegExp(county)}(?:\\s+County)?\\b`, 'i');
    return pattern.test(geography);
  });

  if (counties.length) return counties;
  return ['Statewide'];
}

function parseMoneyToken(numberText, scaleText = '') {
  const numeric = Number.parseFloat(numberText.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const scale = scaleText.toLowerCase();
  if (scale === 'b' || scale.startsWith('billion')) return Math.round(numeric * 1_000_000_000);
  if (scale === 'm' || scale.startsWith('million')) return Math.round(numeric * 1_000_000);
  if (scale === 'k' || scale.startsWith('thousand')) return Math.round(numeric * 1_000);
  return Math.round(numeric);
}

function parseAmounts(value) {
  const text = cleanText(value);
  const amounts = [];
  const matcher = /\$\s*([\d,.]+)\s*(billion|million|thousand|[kmb])?/gi;
  let match;
  while ((match = matcher.exec(text))) {
    const amount = parseMoneyToken(match[1], match[2] || '');
    if (amount !== null) amounts.push(amount);
  }

  if (!amounts.length) return { amountMin: null, amountMax: null };
  if (amounts.length >= 2) {
    return {
      amountMin: Math.min(...amounts),
      amountMax: Math.max(...amounts),
    };
  }

  const amount = amounts[0];
  if (/\b(up to|maximum|max\.?|not to exceed)\b/i.test(text)) {
    return { amountMin: null, amountMax: amount };
  }
  if (/\b(at least|minimum|min\.?|starting at)\b/i.test(text)) {
    return { amountMin: amount, amountMax: null };
  }
  return { amountMin: amount, amountMax: amount };
}

function extractUrl(...values) {
  for (const value of values) {
    const match = String(value || '').match(/https?:\/\/[^\s;]+/i);
    if (!match) continue;
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Try the next official URL field.
    }
  }
  return null;
}

function normalizeGrant(record) {
  const { amountMin, amountMax } = parseAmounts(record.EstAmounts);
  return {
    id: cleanText(record.PortalID || record.GrantID || record._id),
    title: cleanText(record.Title) || 'Untitled grant',
    agency: cleanText(record.AgencyDept) || 'California state agency',
    summary: truncateSummary(record.Purpose || record.Description) || 'See the official grant page for details.',
    categories: splitList(record.Categories),
    applicantTypes: mapApplicantTypes(record.ApplicantType),
    counties: parseCounties(record.Geography),
    openDate: toDateOnly(record.OpenDate),
    closeDate: toDateOnly(record.ApplicationDeadline),
    amountMin,
    amountMax,
    applyUrl: extractUrl(record.GrantURL, record.ElecSubmission, record.AgencyURL),
  };
}

function isOpenOrOpeningSoon(record, today) {
  const status = cleanText(record.Status).toLowerCase();
  const allowedStatus = ['active', 'forecasted', 'open', 'posted'].includes(status);
  if (!allowedStatus) return false;

  const openDate = toDateOnly(record.OpenDate);
  const closeDate = toDateOnly(record.ApplicationDeadline);
  if (closeDate && closeDate < today) return false;
  if (openDate && openDate > addDays(today, UPCOMING_WINDOW_DAYS)) return false;
  return true;
}

async function requestJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'CA-Grant-Match/1.0 (public data refresh)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.success) throw new Error(`${label} returned success=false`);
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function findResource() {
  const dataset = await requestJson(PACKAGE_API, 'Dataset metadata request');
  const resource = dataset.resources.find(
    (item) => item.datastore_active && String(item.format).toUpperCase() === 'CSV',
  );
  if (!resource?.id) throw new Error('No active CSV DataStore resource was found.');
  return resource.id;
}

async function fetchAllRecords(resourceId) {
  const records = [];
  let offset = 0;
  let fieldNames = [];
  let total = Infinity;

  while (offset < total) {
    const url = new URL(DATASTORE_API);
    url.searchParams.set('resource_id', resourceId);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const result = await requestJson(url, `DataStore page at offset ${offset}`);

    if (!fieldNames.length) fieldNames = result.fields.map((field) => field.id);
    total = Number(result.total);
    records.push(...result.records);
    if (!result.records.length) break;
    offset += result.records.length;
  }

  const missingFields = REQUIRED_FIELDS.filter((field) => !fieldNames.includes(field));
  if (missingFields.length) {
    throw new Error(`Portal schema changed. Missing fields: ${missingFields.join(', ')}`);
  }
  if (Number.isFinite(total) && records.length !== total) {
    throw new Error(`Expected ${total} records but received ${records.length}.`);
  }
  return { records, fieldNames };
}

function sortByDeadline(grants) {
  return grants.sort((a, b) => {
    if (a.closeDate && b.closeDate && a.closeDate !== b.closeDate) {
      return a.closeDate.localeCompare(b.closeDate);
    }
    if (a.closeDate) return -1;
    if (b.closeDate) return 1;
    return a.title.localeCompare(b.title);
  });
}

async function refreshGrants(options = {}) {
  const projectRoot = path.join(__dirname, '..');
  const outputPaths = options.outputPath
    ? [options.outputPath]
    : [path.join(projectRoot, 'public', 'grants.json'), path.join(projectRoot, 'grants.json')];
  const now = options.now || new Date();
  const today = pacificDate(now);
  const resourceId = await findResource();
  console.log(`[CA Grant Match] Using DataStore resource ${resourceId}.`);

  const { records, fieldNames } = await fetchAllRecords(resourceId);
  console.log(`[CA Grant Match] Verified ${fieldNames.length} source fields and fetched ${records.length} records.`);

  const normalized = records
    .filter((record) => isOpenOrOpeningSoon(record, today))
    .map(normalizeGrant)
    .filter((grant) => grant.id && grant.applyUrl);

  const deduped = [...new Map(normalized.map((grant) => [grant.id, grant])).values()];
  const grants = sortByDeadline(deduped);
  if (!grants.length) throw new Error('Refresh produced zero eligible grants; refusing to replace the last good file.');

  const payload = {
    lastUpdated: now.toISOString(),
    source: 'California Grants Portal via the California Open Data Portal',
    resourceId,
    grantCount: grants.length,
    grants,
  };

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  for (const outputPath of outputPaths) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await fs.rename(temporaryPath, outputPath);
  }
  console.log(`[CA Grant Match] Wrote ${grants.length} open or upcoming grants to ${outputPaths.join(' and ')}.`);
  return { outputPath: outputPaths[0], outputPaths, grantCount: grants.length, resourceId };
}

if (require.main === module) {
  refreshGrants().catch((error) => {
    console.error('\n[CA Grant Match] REFRESH FAILED — the last good grants.json was left untouched.');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  CALIFORNIA_COUNTIES,
  mapApplicantTypes,
  parseAmounts,
  parseCounties,
  refreshGrants,
};
