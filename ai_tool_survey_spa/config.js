/**
 * Fill these in after you've done the Azure AD + SharePoint setup in README.md.
 * None of these values are secret — they're all safe to ship in a public,
 * static JS file (the SPA uses delegated auth with PKCE, no client secret
 * ever touches the browser).
 */
window.APP_CONFIG = {
  // Azure AD (Entra ID) App Registration — "Single-page application" platform
  AAD_CLIENT_ID: 'REPLACE_WITH_YOUR_APP_CLIENT_ID',
  AAD_TENANT_ID: 'REPLACE_WITH_YOUR_TENANT_ID', // GUID, or your verified domain e.g. banpu.co.th

  // From setup/resolve-site-id.js and setup/setup-sharepoint-list.js
  SHAREPOINT_SITE_ID: 'REPLACE_WITH_SITE_ID',
  SHAREPOINT_LIST_ID: 'REPLACE_WITH_LIST_ID',
  SHAREPOINT_SUPERVISOR_LIST_ID: '', // optional — only if you created the Supervisor Mapping list

  // Delegated Graph scopes the SPA requests at sign-in.
  // User.Read = read the signed-in user's own profile + manager (for auto-lookup).
  // Sites.ReadWrite.All = read/write the SharePoint list (swap for a narrower
  // custom scope if your AAD app instead uses Sites.Selected).
  GRAPH_SCOPES: ['User.Read', 'Sites.ReadWrite.All'],
};
