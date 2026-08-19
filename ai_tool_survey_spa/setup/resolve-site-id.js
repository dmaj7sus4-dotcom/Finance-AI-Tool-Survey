#!/usr/bin/env node
/**
 * Resolve a SharePoint site's Graph "site id" from its URL, so IT can put it
 * in .env as SHAREPOINT_SITE_ID. Requires AZURE_TENANT_ID / AZURE_CLIENT_ID /
 * AZURE_CLIENT_SECRET to already be set in .env (Sites.Read.All or
 * Sites.ReadWrite.All application permission, admin consent granted).
 *
 * Usage:
 *   node scripts/resolve-site-id.js "https://yourtenant.sharepoint.com/sites/YourSiteName"
 */
require('dotenv').config();
const { graphFetch } = require('./graphClient');

async function main() {
  const siteUrl = process.argv[2];
  if (!siteUrl) {
    console.log('Usage: node scripts/resolve-site-id.js "https://yourtenant.sharepoint.com/sites/YourSiteName"');
    process.exit(1);
  }
  const u = new URL(siteUrl);
  const hostname = u.hostname;
  const serverRelativePath = u.pathname; // e.g. /sites/YourSiteName

  try {
    const site = await graphFetch(`/sites/${hostname}:${serverRelativePath}`);
    console.log('\nFound site:');
    console.log('  Display name:', site.displayName);
    console.log('  Site ID     :', site.id);
    console.log('\nPut this in your .env file:');
    console.log(`SHAREPOINT_SITE_ID=${site.id}`);
  } catch (err) {
    console.error('Failed to resolve site id:', err.message);
    process.exit(1);
  }
}

main();
