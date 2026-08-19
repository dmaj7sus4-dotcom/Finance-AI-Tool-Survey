/**
 * Browser-side Microsoft Graph client. Every call carries the signed-in
 * user's own delegated access token (see auth.js) — Graph enforces whatever
 * that user's real SharePoint permissions are, so this file has no
 * "am I an admin?" logic of its own. See README.md "Permission model" for
 * how Submitters vs Approvers are actually enforced (in SharePoint, not here).
 */
const CFG = window.APP_CONFIG;

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
    const err = new Error(`Graph ${opts.method || 'GET'} ${url} failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ---------------- "Who am I / who's my manager" — needs only User.Read ---------------- */

async function getMyProfile() {
  return graphFetch('/me?$select=displayName,mail,userPrincipalName,department,companyName');
}

async function getMyManager() {
  try {
    return await graphFetch('/me/manager?$select=displayName,mail');
  } catch (err) {
    if (err.status === 404) return null; // no manager on file in Entra ID
    throw err;
  }
}

/* ---------------- Optional fallback: a manually-maintained Supervisor Mapping list ---------------- */

async function lookupSupervisorFromList(email) {
  if (!CFG.SHAREPOINT_SUPERVISOR_LIST_ID) return null;
  const filterEmail = String(email || '').trim().toLowerCase().replace(/'/g, "''");
  const url = `/sites/${CFG.SHAREPOINT_SITE_ID}/lists/${CFG.SHAREPOINT_SUPERVISOR_LIST_ID}/items?expand=fields&$filter=fields/Email eq '${filterEmail}'`;
  const page = await graphFetch(url);
  const item = (page.value || [])[0];
  if (!item) return null;
  const f = item.fields;
  return { supName: f.SupName, supEmail: f.SupEmail, cc: f.CostCenter || '' };
}

/* ---------------- The "AI Tool Requests" list itself ---------------- */

function listItemsPath(suffix = '') {
  return `/sites/${CFG.SHAREPOINT_SITE_ID}/lists/${CFG.SHAREPOINT_LIST_ID}${suffix}`;
}

function recordToFields(record) {
  return {
    Title: record.id,
    RequestId: record.id,
    SubmittedAt: record.submittedAt,
    ReqName: record.name,
    ReqEmail: record.email,
    Dept: record.dept,
    BU: record.bu,
    Country: record.country,
    JobRole: record.role,
    Responsibilities: record.resp || '',
    SupName: record.supName,
    SupEmail: record.supEmail,
    CostCenter: record.cc || '',
    ConfidentialJson: JSON.stringify(record.confidential || {}),
    PublicOnly: record.publicOnly || '',
    ActivitiesJson: JSON.stringify(record.activities || []),
    Classification: record.classification,
    AILevel: record.level,
    RecommendedToolsJson: JSON.stringify(record.recommendedTools || []),
    Restricted: !!record.restricted,
    OverrideTool: record.overrideTool || '',
    OverrideReason: record.overrideReason || '',
    ApprovalRequired: !!record.approvalRequired,
    Status: record.status,
    DecidedBy: record.decidedBy || '',
    DecidedAt: record.decidedAt || '',
    DecisionNote: record.decisionNote || '',
  };
}

function fieldsToRecord(item) {
  const f = item.fields || {};
  let confidential = {}, activities = [], recommendedTools = [];
  try { confidential = JSON.parse(f.ConfidentialJson || '{}'); } catch (_) {}
  try { activities = JSON.parse(f.ActivitiesJson || '[]'); } catch (_) {}
  try { recommendedTools = JSON.parse(f.RecommendedToolsJson || '[]'); } catch (_) {}
  return {
    _itemId: item.id,
    id: f.RequestId, submittedAt: f.SubmittedAt,
    name: f.ReqName, email: f.ReqEmail, dept: f.Dept, bu: f.BU, country: f.Country,
    role: f.JobRole, resp: f.Responsibilities,
    supName: f.SupName, supEmail: f.SupEmail, cc: f.CostCenter,
    confidential, publicOnly: f.PublicOnly, activities,
    classification: f.Classification, level: f.AILevel,
    recommendedTools, restricted: !!f.Restricted,
    overrideTool: f.OverrideTool, overrideReason: f.OverrideReason,
    approvalRequired: !!f.ApprovalRequired, status: f.Status,
    decidedBy: f.DecidedBy, decidedAt: f.DecidedAt, decisionNote: f.DecisionNote,
  };
}

async function createRequestItem(record) {
  await graphFetch(listItemsPath('/items'), {
    method: 'POST',
    body: JSON.stringify({ fields: recordToFields(record) }),
  });
  return record;
}

/**
 * Returns whatever requests the SIGNED-IN USER is allowed to see.
 * A regular Submitter will only get their own items back (SharePoint
 * item-level permission trims the rest); an Approver sees everyone's.
 * This file makes no distinction between the two — SharePoint does.
 */
async function listVisibleRequests() {
  const items = [];
  let url = listItemsPath('/items') + '?expand=fields&$top=200';
  while (url) {
    const page = await graphFetch(url);
    items.push(...(page.value || []));
    url = page['@odata.nextLink'] || null;
  }
  return items.map(fieldsToRecord);
}

/**
 * Attempts to update a request's decision. Throws with err.status === 403
 * if the signed-in user doesn't actually have edit rights on the list in
 * SharePoint — the caller should show a friendly permission-denied message
 * rather than treating that as a bug.
 */
async function decideRequest(itemId, decision, note, decidedByName) {
  const patch = {
    Status: decision,
    DecidedBy: decidedByName,
    DecidedAt: new Date().toISOString(),
    DecisionNote: note || '',
  };
  await graphFetch(listItemsPath(`/items/${itemId}/fields`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ---------------- Client-side CSV export (no server involved) ---------------- */

function exportRequestsToCsv(list) {
  const headers = ['id', 'submittedAt', 'name', 'email', 'dept', 'bu', 'country', 'role', 'supName', 'supEmail',
    'classification', 'level', 'activities', 'recommendedTools', 'overrideTool', 'overrideReason',
    'approvalRequired', 'status', 'decidedBy', 'decidedAt', 'decisionNote'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  list.forEach(r => {
    lines.push(headers.map(h => {
      let v = r[h];
      if (Array.isArray(v)) v = v.join('; ');
      return esc(v);
    }).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ai_tool_requests.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
