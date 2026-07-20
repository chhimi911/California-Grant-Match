#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { grantMatchesFilters, normalizeDisplayAmounts } = require('./matching.js');

const statewideGrant = {
  id: 'statewide',
  applicantTypes: ['business', 'nonprofit'],
  categories: ['Housing'],
  counties: ['Statewide'],
};
const losAngelesGrant = {
  id: 'los-angeles-only',
  applicantTypes: ['business', 'nonprofit'],
  categories: ['Housing'],
  counties: ['Los Angeles'],
};
const alpineGrant = {
  id: 'alpine-only',
  applicantTypes: ['nonprofit'],
  categories: ['Environment'],
  counties: ['Alpine'],
};
const grants = [statewideGrant, losAngelesGrant, alpineGrant];

function matchedIds(filters) {
  return grants.filter((grant) => grantMatchesFilters(grant, filters)).map((grant) => grant.id);
}

assert.deepEqual(
  matchedIds({ applicant: 'nonprofit', category: '', county: 'Alpine' }),
  ['statewide', 'alpine-only'],
  'Alpine must include statewide and Alpine grants, but exclude Los Angeles-only grants.',
);
assert.deepEqual(
  matchedIds({ applicant: 'business', category: '', county: 'Los Angeles' }),
  ['statewide', 'los-angeles-only'],
  'Los Angeles must include statewide and Los Angeles grants.',
);
assert.deepEqual(
  matchedIds({ applicant: 'business', category: '', county: 'Alpine' }),
  ['statewide'],
  'Applicant and county filters must both apply.',
);
assert.deepEqual(
  matchedIds({ applicant: 'nonprofit', category: 'Housing', county: '' }),
  ['statewide', 'los-angeles-only'],
  'The empty county selection must represent all of California.',
);
assert.deepEqual(
  normalizeDisplayAmounts(1, 1_000_000),
  { amountMin: null, amountMax: 1_000_000 },
  'A $1 placeholder minimum must be hidden when a meaningful maximum exists.',
);

const projectRoot = path.join(__dirname, '..');
const publicData = fs.readFileSync(path.join(projectRoot, 'public', 'grants.json'), 'utf8');
const rootData = fs.readFileSync(path.join(projectRoot, 'grants.json'), 'utf8');
assert.equal(rootData, publicData, 'The root and public grant data files must remain identical.');

const payload = JSON.parse(publicData);
assert.ok(Array.isArray(payload.grants) && payload.grants.length > 0, 'Grant data must be non-empty.');
for (const grant of payload.grants) {
  assert.ok(Array.isArray(grant.counties) && grant.counties.length > 0, `${grant.id} must have geography data.`);
}

console.log(`[CA Grant Match] ${payload.grants.length} grants validated; filter regression tests passed.`);
