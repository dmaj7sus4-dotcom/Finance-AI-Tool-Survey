# AI Tool Request & Assessment Form — Serverless Edition

No server. No admin password. Every user signs in with their own Microsoft
account (Entra ID) and their browser talks to your SharePoint List directly
through Microsoft Graph. Approval rights are enforced by real SharePoint
permissions, not by app code — so there's nothing for anyone to hack around
by editing JavaScript in dev tools.

This supersedes the earlier Node.js/Express version. If you already set that
one up, you can retire it — all business logic (recommendation engine,
governance rules) is identical here, just talking to Graph directly instead
of through a Node backend.

## Why "serverless" instead of the previous Node app

You asked whether this could just be a Cowork Artifact to make it "online."
Short answer: an Artifact can only run static HTML/JS in the Claude desktop
app's own sidebar — it can't execute the Node.js backend code (routes,
sessions, the Graph client holding a secret) we'd written, because Artifacts
never run server-side code or hold secrets. Rather than keep a separate
always-on Node server running somewhere (which someone has to babysit), this
version removes the server entirely: it's just static files, and the
"backend" is SharePoint itself, reached straight from each user's browser.

## Architecture

```
Employee's browser  --sign in-->  Microsoft Entra ID (delegated, PKCE)
                     --Graph API, user's own token-->  SharePoint List
```

- **Auth:** MSAL.js (vendored in `vendor/`), Authorization Code + PKCE flow. No client secret ever touches the browser — there isn't one to steal.
- **Data:** the "AI Tool Requests" SharePoint list, read/written via Microsoft Graph, using each signed-in user's own delegated permissions.
- **Who can approve:** decided entirely by SharePoint list permissions (see below) — this app has no concept of "admin," it just tries the write and shows a friendly message if SharePoint says no.
- **Recommendation engine:** unchanged, still `recommendation.js`, shared by every step of the wizard.

## Important limitation to know up front

**This has not been tested against a real Microsoft 365 tenant** — this
environment has no Azure AD app / SharePoint site to test against. The
wizard logic, governance rules, and error handling were verified with
automated browser tests using a mocked sign-in; the actual Entra ID
sign-in → Graph → SharePoint round trip needs to be verified by your IT team
against your real tenant during setup. If something doesn't work exactly as
described (menu wording in the Azure/SharePoint admin UI does shift between
Microsoft's updates), that's the part to double-check first.

## Setup — do this in order

### 1. Azure AD (Entra ID) App Registration

One App Registration, used two different ways:

**a) Delegated / SPA (what the deployed app actually uses at runtime)**
- Azure Portal → Entra ID → App registrations → New registration.
- Under **Authentication**, add a platform → **Single-page application** → redirect URI = wherever you'll host this (e.g. `https://your-app.azurestaticapps.net/`). You can add `http://localhost:8080/` too for local testing.
- Under **API permissions**, add **Delegated** permissions: `User.Read` (usually already there by default) and `Sites.ReadWrite.All` (or `Sites.Selected` if you want to scope it to just this one site — ask IT which they prefer). Have an admin grant consent.
- Copy the **Application (client) ID** and **Directory (tenant) ID** into `config.js`.

**b) App-only (only for the one-time setup scripts in `setup/`, never used at runtime)**
- Same App Registration → **Certificates & secrets** → new client secret.
- Under **API permissions**, also add the **Application** permission `Sites.ReadWrite.All`, admin-consented.
- Put `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` into `setup/.env` (copy from `setup/.env.example`). You can delete this secret after setup if you don't want it lingering — the deployed app never uses it.

### 2. Create the SharePoint list

```bash
cd setup
npm install
cp .env.example .env   # fill in the app-only credentials from step 1b
npm run resolve-site -- "https://yourtenant.sharepoint.com/sites/YourSiteName"
# copy the printed SHAREPOINT_SITE_ID into .env
npm run setup-list
# copy the printed SHAREPOINT_LIST_ID into ../config.js
```

Add `-- --with-supervisor-list` to also create a "Supervisor Mapping" list as a manual fallback for when someone has no manager set in Entra ID.

### 3. Set the SharePoint permission model — the part that actually enforces approval rights

This is the step that makes "who can approve" real, instead of just a UI
suggestion. The goal: everyone can submit a request and see their own; only
approvers can see everyone's and change a request's status.

1. On your SharePoint site, create two groups (Site Settings → Site permissions → Create Group, or via the Microsoft 365 group if that's how the site is set up):
   - **AI Tool Submitters** — add everyone who should be able to submit requests (could be "Everyone except external users," or a specific department group).
   - **AI Tool Approvers** — add the supervisors / governance team who should be able to approve or reject.
2. Create a custom permission level for submitters: Site Settings → Site permissions → Permission Levels → **Copy** the "Contribute" level → name it **"Submit Only"** → uncheck **Edit Items** and **Delete Items** under List Permissions, leave **Add Items** and **View Items** checked → Save.
3. On the **AI Tool Requests** list → List Settings → Permissions for this list → **Stop Inheriting Permissions** → remove inherited groups → grant:
   - **AI Tool Submitters** → the **Submit Only** level you just created.
   - **AI Tool Approvers** → **Design** (or Full Control) — this specific level matters, see the note below.
4. Still in List Settings → **Advanced Settings** → **Item-level Permissions** → set:
   - Read access: **"Read items that were created by the user"**
   - Create and Edit access: **"Create items and edit items that were created by the user"**

**Why Approvers need "Design," not "Contribute":** the item-level restriction in step 4 only applies to people *without* the "Manage Lists" permission. "Design" and "Full Control" include Manage Lists, so Approvers bypass the restriction and see/edit every item; "Contribute" does not, so Submitters are correctly limited to their own items. This is standard (if slightly obscure) SharePoint behavior — if it doesn't seem to be working as described, this is the first thing to double check with IT, since Microsoft's exact admin UI wording shifts between tenant updates.

With this in place: a Submitter's browser calling the same Graph endpoint as an Approver's browser gets a different, correctly-scoped result — there's no app code deciding who sees what.

### 4. Fill in `config.js` and host the static files

Edit `config.js` with the four IDs above. Nothing in it is secret — it's safe in a public static file.

Then host `index.html`, `config.js`, `recommendation.js`, `auth.js`, `graph.js`, `app.js`, `style.css`, and the `vendor/` folder somewhere reachable by your team's browsers, as plain static files, over HTTPS. Straightforward, low/no-maintenance options:

- **Azure Static Web Apps** (recommended) — free tier, HTTPS and a custom domain included, deploys straight from a Git repo or the Azure CLI, sits naturally alongside the Azure AD app registration you already made.
- **Azure Blob Storage static website hosting** — even simpler, just upload the files; add Azure CDN in front if you want a custom domain + faster edge delivery.
- Any other static host you already use (Netlify, GitHub Pages, an internal web server) works too — the only requirement is that its URL exactly matches a redirect URI you registered in step 1a.

**Why not literally inside a SharePoint document library:** SharePoint Online blocks custom script execution from document libraries and most page types by default (a deliberate anti-XSS protection Microsoft added years ago) — uploading `index.html` there and opening it will not run the JavaScript. Embedding this as a genuinely native SharePoint experience would mean building it as an SPFx web part, which needs your tenant's App Catalog and a real build/deploy pipeline — a bigger lift than this app needs. Hosting the (few KB of) static files outside SharePoint while all the actual data stays inside SharePoint gets you the same practical outcome — "our data lives in SharePoint" — without that extra infrastructure.

### 5. Test with one Submitter account and one Approver account

Before rolling out broadly: sign in as a test Submitter, confirm they can submit and only see their own request; sign in as a test Approver, confirm they see everyone's requests and can Approve/Reject. If a Submitter can somehow edit or approve — stop and recheck step 3, don't go live.

## File structure

```
index.html          Loads everything, has the sign-in screen + #root mount point
config.js            IT fills this in — tenant/client/site/list IDs (no secrets)
auth.js               MSAL wiring: sign-in, sign-out, silent token refresh
graph.js              Graph calls: profile/manager lookup, list CRUD, CSV export
app.js                The wizard UI + My Requests/Approvals tab
recommendation.js     Shared recommendation-engine logic (Sections 3-5 of the spec)
style.css             All styling
vendor/msal-browser.min.js   Vendored MSAL.js so there's no external CDN dependency
setup/                One-time local CLI (Node) to provision the SharePoint list —
                       run once by IT, not part of the deployed app
```

## How the recommendation/approval logic works

Unchanged from the earlier versions of this app:

- **Data Classification**: "Confidential" if any of the 10 confidentiality questions is Yes; otherwise "Non-Confidential."
- **AI Level**: the highest level (1/2/3) among the activities selected.
- **Recommended tool(s)**: each activity maps to a default tool; if data is Confidential, any Claude-platform tool gets swapped for **Copilot Cowork** and flagged, per "Confidential Data = Copilot Platform Only."
- **Approval required**: Yes for AI Level 3 or a mandatory-approval tool (Copilot Cowork / Claude Cowork / Claude Code), or a forced policy-exception when someone overrides to a Claude tool while confidential. Level 2 is optional/policy-driven. Level 1 needs none.

The one thing that's genuinely different from the Node version: there, the
*server* recomputed this from raw answers so a tampered client couldn't lie
about it. Here there's no server to do that recompute — the browser computes
once and writes what it computed. The real backstop is now SharePoint
permissions (a Submitter literally cannot write to fields they shouldn't be
able to, if you've locked down columns/permissions tightly) rather than a
trusted server. For most internal-governance purposes this is a fine
trade-off, but if you need bulletproof tamper-resistance on the calculation
itself (not just on who can approve), that's the one thing a small serverless
Azure Function (still no VM to manage, but a tiny bit of backend) could add
back — ask if you want that as a follow-up.
