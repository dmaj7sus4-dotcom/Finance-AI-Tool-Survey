/* Admin console — reads and decides requests via the Apps Script backend.
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
  filter: 'all',
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
    if(!q) return true;
    return [r.RequestId, r.Name, r.Email, r.Department, r.BusinessUnit, r.SupervisorName, r.RecommendedTools]
      .some(v => String(v||'').toLowerCase().includes(q));
  });
}

function renderConsole(){
  if(st.loading) return `<div class="card">กำลังโหลด...</div>`;

  const all = st.requests;
  const pending = all.filter(r=>r.Status==='pending').length;
  const conf = all.filter(r=>r.Classification==='confidential').length;
  const lvl3 = all.filter(r=>Number(r.AILevel)===3).length;

  const stats = `<div class="stat-row">
    <div class="stat"><div class="n">${all.length}</div><div class="l">คำขอทั้งหมด</div></div>
    <div class="stat"><div class="n">${pending}</div><div class="l">รออนุมัติ</div></div>
    <div class="stat"><div class="n">${conf}</div><div class="l">ข้อมูลลับ</div></div>
    <div class="stat"><div class="n">${lvl3}</div><div class="l">AI Level 3</div></div>
  </div>`;

  const controls = `<div class="admin-controls">
    <div class="chip-row">
      ${[['all','ทั้งหมด'],['pending','รออนุมัติ'],['decided','ตัดสินแล้ว'],['confidential','ข้อมูลลับ']]
        .map(([k,l])=>`<button class="chip ${st.filter===k?'on':''}" onclick="st.filter='${k}';render()">${l}</button>`).join('')}
    </div>
    <input type="search" id="searchbox" class="searchbox" placeholder="ค้นหาชื่อ / อีเมล / Request ID"
           value="${esc(st.search)}" oninput="st.search=this.value;renderTableOnly()">
    <div class="spacer"></div>
    <button class="btn secondary" onclick="refresh()">↻ รีเฟรช</button>
    <button class="btn secondary" onclick="exportCsv()" ${all.length?'':'disabled'}>⬇ Export CSV</button>
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
          <div><strong>Job Role:</strong> ${esc(r.JobRole)}</div>
          <div><strong>Cost Center:</strong> ${esc(r.CostCenter)||'-'}</div>
          <div><strong>Public Data Only:</strong> ${esc(r.PublicDataOnly)||'-'}</div>
        </div>
        ${r.Responsibilities ? `<div style="margin-top:8px"><strong>หน้าที่หลัก:</strong> ${esc(r.Responsibilities)}</div>` : ''}
        <div style="margin-top:8px"><strong>กิจกรรมที่เลือก:</strong> ${esc(r.Activities)}</div>
        <div><strong>ข้อมูลลับที่ตอบ Yes:</strong> ${yesFields.length ? esc(yesFields.join(', ')) : '— ไม่มี —'}</div>
        <div><strong>ระบบแนะนำ:</strong> ${esc(r.RecommendedTools)} ${r.Restricted==='Yes'?'<span class="tag tag-dep">ปรับเพราะข้อมูลลับ</span>':''}</div>
        ${r.OverrideTool ? `<div><strong>ผู้ใช้เลือกเอง:</strong> ${esc(r.OverrideTool)} — ${esc(r.OverrideReason)||'ไม่ระบุเหตุผล'}</div>` : ''}
        <div><strong>เหตุผลที่ต้อง/ไม่ต้องอนุมัติ:</strong> ${esc(r.ApprovalReason)}</div>
        ${decisionUi}
      </td></tr>`;
    }
    return `<tr class="${r.Status==='pending'?'is-pending':''}">
      <td><button class="link-btn" onclick="toggle('${esc(id)}')">${esc(id)}</button></td>
      <td>${fmtDate(r.SubmittedAt)}</td>
      <td>${esc(r.Name)}<br><span class="hint">${esc(r.Department)} / ${esc(r.BusinessUnit)}</span></td>
      <td>${r.Classification==='confidential'?'<span class="tag tag-yes">Confidential</span>':'<span class="tag tag-no">Non-Conf.</span>'}</td>
      <td><span class="lvl-pill lvl-${esc(r.AILevel)}">Level ${esc(r.AILevel)}</span></td>
      <td>${esc(finalTool)}</td>
      <td>${r.ApprovalRequired==='Yes'?'Yes':'No'}</td>
      <td><span class="pill-status ${statusClass(r.Status)}">${esc(String(r.Status||'').toUpperCase())}</span></td>
    </tr>${detail}`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">ไม่พบคำขอที่ตรงเงื่อนไข</td></tr>`;

  return `<table class="audit-table">
    <tr><th>Request ID</th><th>ส่งเมื่อ</th><th>ผู้ขอ</th><th>Classification</th><th>Level</th><th>เครื่องมือ</th><th>ต้องอนุมัติ</th><th>สถานะ</th></tr>
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
  // BOM so Excel opens Thai text correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ai_tool_requests.csv';
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
