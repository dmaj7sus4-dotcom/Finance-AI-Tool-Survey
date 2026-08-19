msal-browser.min.js is @azure/msal-browser v5.18.0 (Microsoft's official
MSAL.js library for browser-based delegated Entra ID sign-in), vendored here
as a plain file instead of loaded from a CDN, so the app has no external
runtime dependency and works even if your hosting environment blocks
third-party script CDNs by policy.

To update it later: `npm install @azure/msal-browser` anywhere with Node,
then copy node_modules/@azure/msal-browser/lib/msal-browser.min.js over this
file. Check the MSAL.js changelog for breaking API changes before upgrading
across major versions (this app uses `new msal.PublicClientApplication(...)`
followed by `await instance.initialize()`, per the v3+ recommended pattern).
