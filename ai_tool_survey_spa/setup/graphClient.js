/**
 * Minimal Microsoft Graph client using the OAuth2 client-credentials flow
 * (app-only auth — no user sign-in needed for the app itself).
 *
 * Requires an Azure AD (Entra ID) App Registration from your IT team with:
 *   - Application permission: Sites.ReadWrite.All (to read/write the SharePoint list)
 *     (or Sites.Selected scoped to just this one site, if IT prefers tighter scope)
 *   - Application permission: User.Read.All (optional, only needed for the
 *     live Entra ID supervisor/manager auto-lookup — see entraLookup.js)
 *   - Admin consent granted for both permissions
 *
 * Uses Node's built-in global fetch (Node 18+) — no extra HTTP dependency.
 */
const REQUIRED_ENV = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];

function assertConfigured() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Microsoft Graph is not configured — missing env vars: ${missing.join(', ')}. ` +
      `Set STORAGE_BACKEND=local in .env to run without SharePoint, or fill in the Azure AD app credentials.`
    );
  }
}

let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) {
    return cachedToken.accessToken;
  }
  const tenantId = process.env.AZURE_TENANT_ID;
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to acquire Graph token (${res.status}): ${text}`);
  }
  const json = await res.json();
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * Call any Microsoft Graph endpoint with an app-only bearer token.
 * @param {string} pathOrUrl - e.g. '/sites/{site-id}/lists/{list-id}/items' or a full URL
 * @param {object} opts - fetch options (method, body, headers...)
 */
async function graphFetch(pathOrUrl, opts = {}) {
  const token = await getAccessToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  const headers = Object.assign(
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    opts.headers || {}
  );
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Graph API ${opts.method || 'GET'} ${url} failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

module.exports = { getAccessToken, graphFetch, assertConfigured };
