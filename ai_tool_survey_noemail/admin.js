/* Admin console (NO-EMAIL BUILD) — reads and decides requests via the Apps
 * Script backend, and doubles as the worklist for approvals you send yourself.
 *
 * This build never emails anyone. Instead it gives you what you need to write
 * the emails: a "ต้องส่งขออนุมัติ" filter, the supervisor addresses in one
 * copyable string, a ready-made message per request that already contains that
 * request's signed approval link, and a flag to mark each one as sent so two
 * people don't email the same supervisor twice.
 *
 *
 * The password is never checked here. It's sent with each request and verified
 * inside Apps Script, so viewing the source of this page tells an attacker
 * nothing and there is no client-side check to bypass.
 */
const RE = window.RecommendationEngine;

const st = {
  password: sessionStorage.getItem('aitool_admin_pw') || '',
  authed: false,
  loading: false,
  error: '',
  loginError: '',
  requests: [],
  filter: 'tosend',   // land on the worklist, not on everything
  search: '',
  expanded: null,
  notes: {},
  busyId: null,
};

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(v){
  if(!v) return '-';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'short' });
}
function statusClass(s){
  return s==='approved' ? 'pill-approved'
       : s==='rejected' ? 'pill-rejected'
       : s==='auto-approved' ? 'pill-auto' : 'pill-pending';
}

/* ---------------- worklist helpers ---------------- */

/** Still needs a decision AND nobody has told the supervisor yet. */
function needsSending(r) {
  return String(r.Status) === 'pending'
      && String(r.ApprovalEmailSent || '').indexOf('sent') !== 0;
}

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/**
 * Clipboard write with a fallback: navigator.clipboard needs a secure context
 * and can be blocked outright, and this page has to keep working when it is.
 */
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอก' + what + 'แล้ว');
    return;
  } catch (e) { /* fall through to the old way */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('คัดลอก' + what + 'แล้ว');
  } catch (e) {
    toast('คัดลอกไม่ได้ — กรุณาเลือกข้อความแล้วกด Ctrl+C เอง');
  }
  document.body.removeChild(ta);
}

/** The message to send a supervisor, ready to paste into Outlook. */
function composeEmail(r) {
  const finalTool = r.OverrideTool || r.RecommendedTools || '-';
  const unit = [r.Department, r.BusinessUnit].filter(Boolean).join(' / ');
  return [
    'เรียน คุณ' + (r.SupervisorName || ''),
    '',
    (r.Name || '') + ' ได้ยื่นคำขอใช้เครื่องมือ AI และระบุท่านเป็นผู้อนุมัติ',
    'ขอความกรุณาพิจารณาตามรายละเอียดด้านล่างครับ/ค่ะ',
    '',
    'Request ID        : ' + (r.RequestId || ''),
    'ผู้ขอ              : ' + (r.Name || '') + ' <' + (r.Email || '') + '>',
    // Department / BusinessUnit / JobRole are optional now (the form stopped
    // asking for the last two). null means "drop this line entirely" -- an
    // empty string would keep it as a deliberate blank spacer line, which is
    // why the two are distinguished in the filter below.
    unit ? 'หน่วยงาน           : ' + unit : null,
    r.JobRole ? 'ตำแหน่ง            : ' + r.JobRole : null,
    'ความลับของข้อมูล   : ' + (r.Classification === 'confidential' ? 'Confidential' : 'Non-Confidential'),
    'AI Level           : Level ' + (r.AILevel || ''),
    'กิจกรรมที่ขอใช้     : ' + (r.Activities || ''),
    'เครื่องมือ          : ' + finalTool,
    r.OverrideTool ? 'ผู้ขอเลือกเอง      : ' + r.OverrideTool + ' — ' + (r.OverrideReason || 'ไม่ระบุเหตุผล') : null,
    'เหตุผลที่ต้องอนุมัติ : ' + (r.ApprovalReason || ''),
    '',
    'กดลิงก์นี้เพื่ออนุมัติหรือปฏิเสธ (ระบบจะบันทึกผลอัตโนมัติ):',
    r.ApprovalLink || '(ไม่มีลิงก์ — คำขอนี้ถูกพิจารณาไปแล้ว)',
    '',
    'ลิงก์ออกให้เฉพาะคำขอนี้ · การกดเปิดยังไม่ถือเป็นการอนุมัติ จะมีหน้าให้ยืนยันอีกครั้ง',
    '',
    'ขอบคุณครับ/ค่ะ',
    'ทีมกำกับดูแลการใช้ AI — Finance',
  ].filter(l => l !== null).join('\n');   // '' is kept: those are blank spacer lines
}

function emailSubject(r) {
  return '[ขออนุมัติ] การใช้เครื่องมือ AI — ' + (r.Name || '') + ' (' + (r.RequestId || '') + ')';
}

function findRow(id) {
  return st.requests.find(x => String(x.RequestId) === id);
}

/** Hand the whole thing to Outlook prefilled, for anyone who'd rather not paste. */
function openInMailClient(id) {
  const r = findRow(id);
  if (!r) return;
  const body = composeEmail(r);
  const url = 'mailto:' + encodeURIComponent(r.SupervisorEmail || '')
    + '?subject=' + encodeURIComponent(emailSubject(r))
    + '&body=' + encodeURIComponent(body);
  // Windows caps the length of a mailto: it will hand to Outlook; past that the
  // link silently opens an empty message, so copy instead of pretending.
  if (url.length > 1900) {
    copyText(body, 'ข้อความอีเมล');
    toast('เนื้อหายาวเกินกว่าจะเปิด Outlook อัตโนมัติ — คัดลอกให้แล้ว วางในอีเมลได้เลย');
    return;
  }
  window.location.href = url;
}

function copyOneEmail(id) { const r = findRow(id); if (r) copyText(composeEmail(r), 'ข้อความอีเมล'); }
function copyOneLink(id)  { const r = findRow(id); if (r && r.ApprovalLink) copyText(r.ApprovalLink, 'ลิงก์อนุมัติ'); }

/** Every supervisor still waiting to be told, deduplicated, ready for the To: field. */
function copyAllSupervisors() {
  const seen = [];
  st.requests.filter(needsSending).forEach(r => {
    const e = String(r.SupervisorEmail || '').trim();
    if (e && seen.indexOf(e) === -1) seen.push(e);
  });
  if (!seen.length) { toast('ไม่มีรายการที่ต้องส่ง'); return; }
  copyText(seen.join('; '), 'อีเมลหัวหน้า ' + seen.length + ' คน');
}

async function markEmailed(id, sent) {
  st.busyId = id; renderTableOnly();
  try {
    await API.call({ action: 'markEmailed', password: st.password, id: id, sent: sent });
    const row = findRow(id);
    if (row) row.ApprovalEmailSent = sent ? ('sent ' + new Date().toISOString() + ' by admin') : 'not-sent';
    toast(sent ? 'ทำเครื่องหมายว่าส่งแล้ว' : 'ยกเลิกเครื่องหมายแล้ว');
  } catch (e) {
    st.error = 'บันทึกไม่สำเร็จ: ' + e.message;
  }
  st.busyId = null;
  render();
}

function render(){
  const root = document.getElementById('root');
  if(!API.configured()){
    root.innerHTML = `<div class="card setup-warn"><h3>⚙️ ยังตั้งค่าไม่เสร็จ</h3>
      <p>ใส่ Web app URL ลงใน <code>config.js</code> ก่อน (ดูขั้นตอนที่ 3 ใน README)</p></div>`;
    return;
  }
  root.innerHTML = st.authed ? renderConsole() : renderLogin();
}

/* ---------------- Login ---------------- */
function renderLogin(){
  return `
  <div class="card signin-card">
    <div class="ms-icon">🔑</div>
    <h2>เข้าสู่หน้า Admin</h2>
    <p class="sec-desc">ใส่รหัสผ่านที่ตั้งไว้ในสคริปต์ (ตัวแปร ADMIN_PASSWORD)</p>
    <div class="field" style="max-width:320px;margin:0 auto 12px">
      <input type="password" id="pw" value="${esc(st.password)}" placeholder="รหัสผ่าน"
             onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    ${st.loginError ? `<div class="err">${esc(st.loginError)}</div>` : ''}
    <button class="btn" onclick="doLogin()">เข้าสู่ระบบ</button>
  </div>`;
}

async function doLogin(){
  st.password = document.getElementById('pw').value;
  st.loginError = '';
  if(!st.password){ st.loginError = 'กรุณาใส่รหัสผ่าน'; render(); return; }
  try{
    const data = await API.call({ action:'list', password: st.password });
    st.requests = data.requests || [];
    st.authed = true;
    sessionStorage.setItem('aitool_admin_pw', st.password);
  }catch(e){
    st.loginError = e.message;
  }
  render();
}

function logout(){
  sessionStorage.removeItem('aitool_admin_pw');
  st.authed = false; st.password = ''; st.requests = [];
  render();
}

/* ---------------- Console ---------------- */
async function refresh(){
  st.loading = true; st.error = ''; render();
  try{
    const data = await API.call({ action:'list', password: st.password });
    st.requests = data.requests || [];
  }catch(e){
    st.error = e.message;
  }
  st.loading = false; render();
}

function visibleRequests(){
  const q = st.search.trim().toLowerCase();
  return st.requests.filter(r => {
    if(st.filter === 'pending' && r.Status !== 'pending') return false;
    if(st.filter === 'decided' && (r.Status === 'pending')) return false;
    if(st.filter === 'confidential' && r.Classification !== 'confidential') return false;
    // The worklist: needs a decision AND nobody has emailed the supervisor yet.
    if(st.filter === 'tosend' && !needsSending(r)) return false;
    if(!q) return true;
    return [r.RequestId, r.Name, r.Email, r.Department, r.BusinessUnit, r.SupervisorName, r.RecommendedTools]
      .some(v => String(v||'').toLowerCase().includes(q));
  });
}

function renderConsole(){
  if(st.loading) return `<div class="card">กำลังโหลด...</div>`;

  const all = st.requests;
  const pending = all.filter(r=>r.Status==='pending').length;
  const tosend = all.filter(needsSending).length;
  const conf = all.filter(r=>r.Classification==='confidential').length;

  const stats = `<div class="stat-row">
    <div class="stat"><div class="n">${all.length}</div><div class="l">คำขอทั้งหมด</div></div>
    <div class="stat ${tosend?'stat-alert':''}"><div class="n">${tosend}</div><div class="l">ต้องส่งขออนุมัติ</div></div>
    <div class="stat"><div class="n">${pending}</div><div class="l">รออนุมัติ</div></div>
    <div class="stat"><div class="n">${conf}</div><div class="l">ข้อมูลลับ</div></div>
  </div>`;

  const controls = `<div class="admin-controls">
    <div class="chip-row">
      ${[['tosend','📧 ต้องส่งขออนุมัติ'],['all','ทั้งหมด'],['pending','รออนุมัติ'],['decided','ตัดสินแล้ว'],['confidential','ข้อมูลลับ']]
        .map(([k,l])=>`<button class="chip ${st.filter===k?'on':''}" onclick="st.filter='${k}';render()">${l}</button>`).join('')}
    </div>
    <input type="search" id="searchbox" class="searchbox" placeholder="ค้นหาชื่อ / อีเมล / Request ID"
           value="${esc(st.search)}" oninput="st.search=this.value;renderTableOnly()">
    <div class="spacer"></div>
    <button class="btn secondary" onclick="copyAllSupervisors()" ${tosend?'':'disabled'}>👥 คัดลอกอีเมลหัวหน้าที่ต้องส่ง (${tosend})</button>
    <button class="btn secondary" onclick="exportWorklistCsv()" ${tosend?'':'disabled'}>⬇ Export รายการที่ต้องส่ง</button>
    <button class="btn secondary" onclick="refresh()">↻ รีเฟรช</button>
    <button class="btn secondary" onclick="exportCsv()" ${all.length?'':'disabled'}>⬇ Export ทั้งหมด</button>
    <button class="btn secondary" onclick="logout()">ออกจากระบบ</button>
  </div>`;

  return `<div class="card">
    ${stats}
    ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
    ${controls}
    <div id="tablewrap">${renderTable()}</div>
  </div>`;
}

function renderTableOnly(){
  const wrap = document.getElementById('tablewrap');
  if(wrap) wrap.innerHTML = renderTable();
}

function renderTable(){
  const list = visibleRequests();
  const rows = list.map(r=>{
    const id = String(r.RequestId||'');
    const isOpen = st.expanded === id;
    const finalTool = r.OverrideTool || r.RecommendedTools || '-';
    let detail = '';
    if(isOpen){
      let confAnswers = {};
      try{ confAnswers = JSON.parse(r.ConfidentialAnswers || '{}'); }catch(_){}
      const yesFields = Object.keys(confAnswers).filter(k=>confAnswers[k]==='yes');
      const decisionUi = (r.Status === 'pending')
        ? `<div class="decision-row">
             <input type="text" placeholder="หมายเหตุ (ถ้ามี)" value="${esc(st.notes[id]||'')}"
                    oninput="st.notes['${esc(id)}']=this.value">
             <button class="btn" ${st.busyId===id?'disabled':''} onclick="decide('${esc(id)}','approved')">✅ อนุมัติ</button>
             <button class="btn danger" ${st.busyId===id?'disabled':''} onclick="decide('${esc(id)}','rejected')">❌ ปฏิเสธ</button>
           </div>`
        : `<div class="hint">ตัดสินโดย ${esc(r.DecidedBy)||'-'} เมื่อ ${fmtDate(r.DecidedAt)}${r.DecisionNote?(' — '+esc(r.DecisionNote)):''}
             <button class="link-btn" onclick="decide('${esc(id)}','pending')">↺ เปลี่ยนกลับเป็นรออนุมัติ</button></div>`;
      detail = `<tr class="row-detail"><td colspan="8">
        <div class="detail-grid">
          <div><strong>อีเมล:</strong> ${esc(r.Email)}</div>
          <div><strong>หัวหน้างาน:</strong> ${esc(r.SupervisorName)} (${esc(r.SupervisorEmail)})</div>
          <div><strong>Country:</strong> ${esc(r.Country)}</div>
          ${r.BusinessUnit ? `<div><strong>Business Unit:</strong> ${esc(r.BusinessUnit)}</div>` : ''}
          ${r.JobRole ? `<div><strong>Job Role:</strong> ${esc(r.JobRole)}</div>` : ''}
          ${r.CostCenter ? `<div><strong>Cost Center:</strong> ${esc(r.CostCenter)}</div>` : ''}
          <div><strong>Public Data Only:</strong> ${esc(r.PublicDataOnly)||'-'}</div>
        </div>
        ${r.Responsibilities ? `<div style="margin-top:8px"><strong>หน้าที่หลัก:</strong> ${esc(r.Responsibilities)}</div>` : ''}
        <div style="margin-top:8px"><strong>กิจกรรมที่เลือก:</strong> ${esc(r.Activities)}</div>
        <div><strong>ข้อมูลลับที่ตอบ Yes:</strong> ${yesFields.length ? esc(yesFields.join(', ')) : '— ไม่มี —'}</div>
        <div><strong>ระบบแนะนำ:</strong> ${esc(r.RecommendedTools)} ${r.Restricted==='Yes'?'<span class="tag tag-dep">ปรับเพราะข้อมูลลับ</span>':''}</div>
        ${r.OverrideTool ? `<div><strong>ผู้ใช้เลือกเอง:</strong> ${esc(r.OverrideTool)} — ${esc(r.OverrideReason)||'ไม่ระบุเหตุผล'}</div>` : ''}
        <div><strong>เหตุผลที่ต้อง/ไม่ต้องอนุมัติ:</strong> ${esc(r.ApprovalReason)}</div>
        ${r.Status === 'pending' ? `
        <div class="sendbox">
          <div class="sendbox-title">ส่งขออนุมัติด้วยตัวเอง</div>
          <div class="sendbox-row">
            <span class="sendbox-label">ถึง</span>
            <code>${esc(r.SupervisorEmail)}</code>
            <button class="btn secondary tiny" onclick="copyText('${esc(r.SupervisorEmail)}','อีเมลหัวหน้า')">คัดลอก</button>
          </div>
          <div class="sendbox-row">
            <span class="sendbox-label">ลิงก์อนุมัติ</span>
            <code class="linkcode">${esc(r.ApprovalLink || '—')}</code>
            <button class="btn secondary tiny" onclick="copyOneLink('${esc(id)}')" ${r.ApprovalLink?'':'disabled'}>คัดลอก</button>
          </div>
          <div class="sendbox-actions">
            <button class="btn" onclick="openInMailClient('${esc(id)}')">✉️ เปิด Outlook พร้อมเนื้อหา</button>
            <button class="btn secondary" onclick="copyOneEmail('${esc(id)}')">📋 คัดลอกข้อความอีเมล</button>
            ${String(r.ApprovalEmailSent||'').indexOf('sent') === 0
              ? `<button class="btn secondary" ${st.busyId===id?'disabled':''} onclick="markEmailed('${esc(id)}', false)">↺ ยกเลิกเครื่องหมายว่าส่งแล้ว</button>`
              : `<button class="btn secondary" ${st.busyId===id?'disabled':''} onclick="markEmailed('${esc(id)}', true)">✔ ทำเครื่องหมายว่าส่งแล้ว</button>`}
          </div>
          <div class="hint" style="margin-top:6px">สถานะการแจ้ง: ${esc(r.ApprovalEmailSent) || '—'}</div>
        </div>` : ''}
        ${decisionUi}
      </td></tr>`;
    }
    const sentFlag = String(r.ApprovalEmailSent || '');
    let sentCell;
    if (sentFlag.indexOf('sent') === 0) {
      sentCell = '<span class="tag tag-no">ส่งแล้ว</span>';
    } else if (sentFlag === 'not-needed') {
      sentCell = '<span class="hint">ไม่ต้องส่ง</span>';
    } else if (r.Status !== 'pending') {
      sentCell = '<span class="hint">—</span>';
    } else {
      sentCell = '<span class="tag tag-yes">ยังไม่ส่ง</span>';
    }
    return `<tr class="${needsSending(r)?'is-pending':''}">
      <td><button class="link-btn" onclick="toggle('${esc(id)}')">${esc(id)}</button></td>
      <td>${fmtDate(r.SubmittedAt)}</td>
      <td>${esc(r.Name)}<br><span class="hint">${esc([r.Department, r.BusinessUnit].filter(Boolean).join(' / '))}</span></td>
      <td>${esc(r.SupervisorName)}<br><span class="hint">${esc(r.SupervisorEmail)}</span></td>
      <td><span class="lvl-pill lvl-${esc(r.AILevel)}">Level ${esc(r.AILevel)}</span></td>
      <td>${esc(finalTool)}</td>
      <td>${sentCell}</td>
      <td><span class="pill-status ${statusClass(r.Status)}">${esc(String(r.Status||'').toUpperCase())}</span></td>
    </tr>${detail}`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">ไม่พบคำขอที่ตรงเงื่อนไข</td></tr>`;

  return `<table class="audit-table">
    <tr><th>Request ID</th><th>ส่งเมื่อ</th><th>ผู้ขอ</th><th>หัวหน้างาน</th><th>Level</th><th>เครื่องมือ</th><th>แจ้งหัวหน้าแล้ว?</th><th>สถานะ</th></tr>
    ${rows}
  </table>`;
}

function toggle(id){
  st.expanded = (st.expanded === id) ? null : id;
  renderTableOnly();
}

async function decide(id, decision){
  st.busyId = id; st.error = ''; renderTableOnly();
  try{
    await API.call({
      action: 'decide',
      password: st.password,
      id: id,
      decision: decision,
      note: st.notes[id] || '',
      decidedBy: 'Admin',
    });
    // Update in place so the table doesn't jump around.
    const row = st.requests.find(r => String(r.RequestId) === id);
    if(row){
      row.Status = decision;
      row.DecidedBy = 'Admin';
      row.DecidedAt = new Date().toISOString();
      row.DecisionNote = st.notes[id] || '';
    }
  }catch(e){
    st.error = 'ดำเนินการไม่สำเร็จ: ' + e.message;
  }
  st.busyId = null;
  render();
}

/* ---------------- CSV export ---------------- */
function exportCsv(){
  const list = visibleRequests();
  if(!list.length) return;
  const headers = Object.keys(list[0]).filter(k => k !== '_row');
  const q = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const lines = [headers.join(',')];
  list.forEach(r => lines.push(headers.map(h => q(r[h])).join(',')));
  downloadCsv(lines, 'ai_tool_requests.csv');
}

/**
 * Just the rows you still have to email about, with only the columns you need
 * to write those emails — including that request's approval link.
 */
function exportWorklistCsv() {
  const rows = st.requests.filter(needsSending);
  if (!rows.length) { toast('ไม่มีรายการที่ต้องส่ง'); return; }
  const cols = [
    ['RequestId', 'Request ID'],
    ['SubmittedAt', 'ส่งเมื่อ'],
    ['Name', 'ผู้ขอ'],
    ['Email', 'อีเมลผู้ขอ'],
    ['Department', 'แผนก'],
    ['BusinessUnit', 'Business Unit'],
    ['JobRole', 'ตำแหน่ง'],
    ['SupervisorName', 'หัวหน้างาน'],
    ['SupervisorEmail', 'อีเมลหัวหน้างาน'],
    ['Classification', 'ความลับของข้อมูล'],
    ['AILevel', 'AI Level'],
    ['Activities', 'กิจกรรม'],
    ['RecommendedTools', 'เครื่องมือที่ระบบแนะนำ'],
    ['OverrideTool', 'ผู้ขอเลือกเอง'],
    ['ApprovalReason', 'เหตุผลที่ต้องอนุมัติ'],
    ['ApprovalLink', 'ลิงก์อนุมัติ'],
  ];
  const q = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const lines = [cols.map(c => q(c[1])).join(',')];
  rows.forEach(r => lines.push(cols.map(c => q(r[c[0]])).join(',')));
  downloadCsv(lines, 'ai_tool_requests_to_send.csv');
  toast('Export ' + rows.length + ' รายการแล้ว');
}

function downloadCsv(lines, filename) {
  // BOM so Excel opens Thai text correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- Boot ---------------- */
(async function boot(){
  if(st.password && API.configured()){
    st.loading = true; render();
    try{
      const data = await API.call({ action:'list', password: st.password });
      st.requests = data.requests || [];
      st.authed = true;
    }catch(e){
      sessionStorage.removeItem('aitool_admin_pw');
      st.password = '';
    }
    st.loading = false;
  }
  render();
})();
