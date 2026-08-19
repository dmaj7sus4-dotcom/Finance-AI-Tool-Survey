/**
 * Delegated Entra ID sign-in via MSAL Browser (loaded from Microsoft's CDN in
 * index.html). Every user signs in as themselves — there is no app-level
 * password and no server holding a secret. The access token this produces is
 * used directly by graph.js to call Microsoft Graph as that user, so
 * SharePoint's own permissions decide what they can actually read/write.
 *
 * sessionStorage is MSAL's own recommended cache location for the redirect
 * flow (the whole page reloads mid-login, so an in-memory cache can't
 * survive that hop) — this is standard practice for a real deployed SPA,
 * not a browser-storage shortcut.
 */
const msalInstance = new msal.PublicClientApplication({
  auth: {
    clientId: window.APP_CONFIG.AAD_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${window.APP_CONFIG.AAD_TENANT_ID}`,
    redirectUri: window.location.origin + window.location.pathname,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
});

let activeAccount = null;
let initialized = false;

async function initAuth() {
  if (!initialized) {
    await msalInstance.initialize(); // required by msal-browser v3+ before any other call
    initialized = true;
  }
  const redirectResult = await msalInstance.handleRedirectPromise().catch(err => {
    console.error('[auth] redirect handling failed:', err);
    return null;
  });
  if (redirectResult && redirectResult.account) {
    activeAccount = redirectResult.account;
  } else {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length) activeAccount = accounts[0];
  }
  return activeAccount;
}

function signIn() {
  msalInstance.loginRedirect({ scopes: window.APP_CONFIG.GRAPH_SCOPES });
}

function signOut() {
  msalInstance.logoutRedirect({ account: activeAccount });
}

function getActiveAccount() {
  return activeAccount;
}

/**
 * Returns a valid Graph access token, refreshing silently when possible.
 * If silent acquisition fails (e.g. first consent, or a Conditional Access
 * challenge), falls back to an interactive redirect — which navigates away,
 * so callers should expect this to sometimes not return.
 */
async function getAccessToken() {
  if (!activeAccount) throw new Error('Not signed in');
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: window.APP_CONFIG.GRAPH_SCOPES,
      account: activeAccount,
    });
    return result.accessToken;
  } catch (err) {
    console.warn('[auth] silent token acquisition failed, retrying interactively:', err.message);
    await msalInstance.acquireTokenRedirect({ scopes: window.APP_CONFIG.GRAPH_SCOPES });
    // Execution does not continue past this point — the page navigates away.
  }
}
