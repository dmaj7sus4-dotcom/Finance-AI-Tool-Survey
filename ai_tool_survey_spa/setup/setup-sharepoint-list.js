#!/usr/bin/env node
/**
 * Creates the "AI Tool Requests" SharePoint list (and, optionally, a
 * "Supervisor Mapping" list) with all the columns this app expects, so IT
 * doesn't have to click through the SharePoint UI by hand.
 *
 * Prereqs (in .env): AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 * with Sites.ReadWrite.All application permission (admin consent granted),
 * and SHAREPOINT_SITE_ID already resolved via scripts/resolve-site-id.js.
 *
 * Usage:
 *   node scripts/setup-sharepoint-list.js                 # creates AIToolRequests only
 *   node scripts/setup-sharepoint-list.js --with-supervisor-list
 */
require('dotenv').config();
const { graphFetch } = require('./graphClient');

const REQUEST_LIST_NAME = 'AI Tool Requests';
const SUPERVISOR_LIST_NAME = 'Supervisor Mapping';

const REQUEST_COLUMNS = [
  { name: 'RequestId', text: { maxLength: 100 } },
  { name: 'SubmittedAt', text: { maxLength: 50 } },
  { name: 'ReqName', text: { maxLength: 200 } },
  { name: 'ReqEmail', text: { maxLength: 200 } },
  { name: 'Dept', text: { maxLength: 200 } },
  { name: 'BU', text: { maxLength: 200 } },
  { name: 'Country', text: { maxLength: 100 } },
  { name: 'JobRole', text: { maxLength: 200 } },
  { name: 'Responsibilities', text: { allowMultipleLines: true } },
  { name: 'SupName', text: { maxLength: 200 } },
  { name: 'SupEmail', text: { maxLength: 200 } },
  { name: 'CostCenter', text: { maxLength: 100 } },
  { name: 'ConfidentialJson', text: { allowMultipleLines: true } },
  { name: 'PublicOnly', text: { maxLength: 20 } },
  { name: 'ActivitiesJson', text: { allowMultipleLines: true } },
  { name: 'Classification', text: { maxLength: 50 } },
  { name: 'AILevel', number: { decimalPlaces: 'none' } },
  { name: 'RecommendedToolsJson', text: { allowMultipleLines: true } },
  { name: 'Restricted', boolean: {} },
  { name: 'OverrideTool', text: { maxLength: 100 } },
  { name: 'OverrideReason', text: { allowMultipleLines: true } },
  { name: 'ApprovalRequired', boolean: {} },
  { name: 'Status', text: { maxLength: 50 } },
  { name: 'DecidedBy', text: { maxLength: 200 } },
  { name: 'DecidedAt', text: { maxLength: 50 } },
  { name: 'DecisionNote', text: { allowMultipleLines: true } },
];

const SUPERVISOR_COLUMNS = [
  { name: 'Email', text: { maxLength: 200 } },
  { name: 'Name', text: { maxLength: 200 } },
  { name: 'Dept', text: { maxLength: 200 } },
  { name: 'BU', text: { maxLength: 200 } },
  { name: 'SupName', text: { maxLength: 200 } },
  { name: 'SupEmail', text: { maxLength: 200 } },
  { name: 'CostCenter', text: { maxLength: 100 } },
];

async function findListByName(siteId, displayName) {
  const page = await graphFetch(`/sites/${siteId}/lists?$select=id,displayName`);
  return (page.value || []).find(l => l.displayName === displayName) || null;
}

async function createList(siteId, displayName, columns) {
  return graphFetch(`/sites/${siteId}/lists`, {
    method: 'POST',
    body: JSON.stringify({
      displayName,
      columns,
      list: { template: 'genericList' },
    }),
  });
}

async function ensureList(siteId, displayName, columns, envVarName) {
  let list = await findListByName(siteId, displayName);
  if (list) {
    console.log(`List "${displayName}" already exists (id: ${list.id}) — skipping creation.`);
  } else {
    console.log(`Creating list "${displayName}"...`);
    list = await createList(siteId, displayName, columns);
    console.log(`Created "${displayName}" (id: ${list.id}).`);
  }
  console.log(`  -> put this in .env:  ${envVarName}=${list.id}`);
  return list;
}

async function main() {
  const siteId = process.env.SHAREPOINT_SITE_ID;
  if (!siteId) {
    console.error('SHAREPOINT_SITE_ID is not set. Run scripts/resolve-site-id.js first.');
    process.exit(1);
  }
  const withSupervisorList = process.argv.includes('--with-supervisor-list');

  await ensureList(siteId, REQUEST_LIST_NAME, REQUEST_COLUMNS, 'SHAREPOINT_LIST_ID');

  if (withSupervisorList) {
    await ensureList(siteId, SUPERVISOR_LIST_NAME, SUPERVISOR_COLUMNS, 'SHAREPOINT_SUPERVISOR_LIST_ID');
  } else {
    console.log('\n(Skipped Supervisor Mapping list — re-run with --with-supervisor-list to create it too.)');
  }

  console.log('\nDone. Update your .env with the id(s) printed above, then set STORAGE_BACKEND=sharepoint.');
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
