/* AI Tool Request & Assessment Form — serverless SPA (Entra ID + Graph + SharePoint) */
const RE = window.RecommendationEngine;
const TOOLS = RE.TOOLS;
const ACTIVITIES = RE.ACTIVITIES;
const CONFIDENTIAL_FIELDS = RE.CONFIDENTIAL_FIELDS;

const state = {
  account: null,
  tab: 'new', // 'new' | 'requests'
  step: 0,
  user: { name:'', email:'', dept:'', bu:'', country:'', role:'', resp:'',
          supName:'', supEmail:'', cc:'', supStatus:'checking', manualSupervisor:false },
  confidential: {},
  publicOnly: null,
  activities: [],
  overrideTool: null,
  overrideReason: '',
  policyOverrideAck: false,
  submitting: false,
  submitted: null,
  submitError: null,
  requestsLoading: false,
  requests: [],
  requestsError: null,
  expandedId: null,
  decisionNote: {},
  decisionError: null,
};

const STEP_TITLES = [
  'AI Tool ที่บริษัทรองรับ','ยืนยันข้อมูลผู้ใช้งาน','ประเมินความลับของข้อมูล',
  'เลือกกิจกรรมที่ต้องใช้ AI','คำแนะนำเครื่องมือ AI','ขั้นตอนการอนุมัติ','สรุปคำขอ & ส่งคำขอ'
];

function levelPill(level){ return `<span class="lvl-pill lvl-${level}">Level ${level}</span>`; }
function toolName(id){ return TOOLS[id] ? TOOLS[id].name : id; }

/* ======================= BOOT ======================= */
async function boot(){
  const account = await initAuth();
  state.account = account;
  if(!account){ renderRoot(); return; }
  await loadProfile();
  renderRoot();
}

async function loadProfile(){
  state.user.supStatus = 'checking';
  try{
    const me = await getMyProfile();
    state.user.name = me.displayName;
    state.user.email = me.mail || me.userPrincipalName;
    state.user.dept = me.department || '';
    state.user.bu = me.companyName || '';
  }catch(e){
    console.error('[profile] failed to load /me:', e.message);
  }
  try{
    const manager = await getMyManager();
    if(manager){
      state.user.supName = manager.displayName;
      state.user.supEmail = manager.mail;
      state.user.supStatus = 'found-entra';
    } else {
      const viaList = await lookupSupervisorFromList(state.user.email);
      if(viaList){
        state.user.supName = viaList.supName; state.user.supEmail = viaList.supEmail; state.user.cc = viaList.cc;
        state.user.supStatus = 'found-list';
      } else {
        state.user.supStatus = 'notfound';
      }
    }
  }catch(e){
    console.error('[profile] manager lookup failed:', e.message);
    state.user.supStatus = 'notfound';
  }
}

function renderRoot(){
  const root = document.getElementById('root');
  if(!state.account){ root.innerHTML = renderSignIn(); return; }
  root.innerHTML = renderUserChip() + renderTabs() + (state.tab==='new' ? renderWizard() : renderRequestsTab());
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ======================= Sign-in ======================= */
function renderSignIn(){
  return `
  <div class="card signin-card">
    <div class="ms-icon">🔐</div>
    <h2>เข้าสู่ระบบด้วยบัญชีองค์กร</h2>
    <p class="sec-desc">ระบบใช้ Microsoft Entra ID ของคุณในการยืนยันตัวตน ดึงข้อมูลหัวหน้างานอัตโนมัติ และควบคุมสิทธิ์การอนุมัติ — ไม่มีรหัสผ่านแยกสำหรับระบบนี้</p>
    <button class="btn ms" onclick="signIn()">Sign in with Microsoft</button>
  </div>`;
}

function renderUserChip(){
  const u = state.user;
  return `<div class="user-chip">Signed in as <strong>${u.name || state.account.username}</strong> (${u.email || state.account.username})
    &nbsp;|&nbsp; <button class="link-btn" onclick="signOut()">Sign out</button></div>`;
}

function renderTabs(){
  return `<div class="top-tabs">
    <button class="${state.tab==='new'?'active':''}" onclick="state.tab='new';renderRoot()">📝 New Request</button>
    <button class="${state.tab==='requests'?'active':''}" onclick="switchToRequests()">📋 My Requests / Approvals</button>
  </div>`;
}

/* ======================= Wizard ======================= */
function renderWizard(){
  const nav = `<nav class="stepper">${STEP_TITLES.map((t,i)=>{
    let cls = 'step-btn';
    if(i===state.step) cls += ' active';
    else if(i < state.step) cls += ' done';
    const disabled = (i > state.step) ? 'disabled' : '';
    return `<button class="${cls}" ${disabled} onclick="goToStep(${i})"><span class="num">${i<state.step?'✓':(i+1)}</span>${t}</button>`;
  }).join('')}</nav>`;
  const renderers = [renderStep0,renderStep1,renderStep2,renderStep3,renderStep4,renderStep5,renderStep6];
  return `<div class="layout">${nav}<main>${renderers[state.step]()}</main></div>`;
}

function goToStep(i){ if(i > state.step) return; state.step = i; renderRoot(); }

/* ---- Step 0: Tool info ---- */
function renderStep0(){
  const rows = Object.values(TOOLS).map(t=>{
    const wd = t.workData==='Yes' ? '<span class="tag tag-yes">Yes</span>'
             : t.workData==='No' ? '<span class="tag tag-no">No</span>'
             : `<span class="tag tag-noconf">${t.workData}</span>`;
    const ap = t.approval==='Required' ? '<span class="tag tag-yes">Required</span>'
             : t.approval==='No' ? '<span class="tag tag-no">No</span>'
             : `<span class="tag tag-dep">${t.approval}</span>`;
    return `<tr><td><strong>${t.name}</strong></td><td>${t.suitable}</td><td>${wd}</td><td>${ap}</td></tr>`;
  }).join('');
  return `
  <div class="card">
    <h2 class="sec-title">Section 1 — AI Tool ที่บริษัทรองรับ</h2>
    <p class="sec-desc">โปรดศึกษาความสามารถของแต่ละเครื่องมือก่อนเริ่มทำแบบสำรวจ</p>
    <table><tr><th>AI Tool</th><th>Suitable For</th><th>Work Data Access</th><th>Approval</th></tr>${rows}</table>
    <div class="btn-row"><div></div><button class="btn" onclick="state.step=1;renderRoot()">เริ่มทำแบบสำรวจ →</button></div>
  </div>`;
}

/* ---- Step 1: Confirm user info (mostly auto from Entra ID) ---- */
function renderStep1(){
  const u = state.user;
  let supBox;
  if(u.supStatus==='checking'){
    supBox = `<div class="lookup-box">🔎 กำลังดึงข้อมูลหัวหน้างานจาก Microsoft Entra ID...</div>`;
  } else if(u.manualSupervisor || u.supStatus==='notfound'){
    supBox = `<div class="lookup-box notfound">⚠️ ไม่พบข้อมูลหัวหน้างานอัตโนมัติ — กรุณากรอกด้วยตนเอง
      <div class="field-row" style="margin-top:10px">
        <div class="field"><label>Supervisor Name <span class="req">*</span></label><input type="text" value="${u.supName}" oninput="state.user.supName=this.value"></div>
        <div class="field"><label>Supervisor Email <span class="req">*</span></label><input type="email" value="${u.supEmail}" oninput="state.user.supEmail=this.value"></div>
      </div></div>`;
  } else {
    const src = u.supStatus==='found-entra' ? 'Microsoft Entra ID (อัตโนมัติ)' : 'Supervisor Mapping List';
    supBox = `<div class="lookup-box found">✅ แหล่งข้อมูล: ${src}<br>Supervisor: <strong>${u.supName}</strong> (${u.supEmail})
      <div><button class="link-btn" onclick="state.user.manualSupervisor=true;renderRoot()">ไม่ถูกต้อง? แก้ไขด้วยตนเอง</button></div></div>`;
  }
  return `
  <div class="card">
    <h2 class="sec-title">Section 2 — ยืนยันข้อมูลผู้ใช้งาน</h2>
    <p class="sec-desc">ชื่อและอีเมลดึงมาจากบัญชี Microsoft ของคุณโดยอัตโนมัติ กรุณาตรวจสอบ/เติมข้อมูลที่เหลือให้ครบ</p>
    <div class="field-row">
      <div class="field"><label>Name</label><input type="text" value="${u.name}" readonly></div>
      <div class="field"><label>Email Address</label><input type="text" value="${u.email}" readonly></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Department</label><input type="text" id="f_dept" value="${u.dept}" oninput="state.user.dept=this.value"></div>
      <div class="field"><label>Business Unit <span class="req">*</span></label><input type="text" id="f_bu" value="${u.bu}" oninput="state.user.bu=this.value"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Country <span class="req">*</span></label>
        <select id="f_country" onchange="state.user.country=this.value">
          <option value="">-- เลือก --</option>
          ${['Thailand','Indonesia','Australia','China','Singapore','Other'].map(c=>`<option ${u.country===c?'selected':''}>${c}</option>`).join('')}
        </select></div>
      <div class="field"><label>Job Role <span class="req">*</span></label><input type="text" id="f_role" value="${u.role}" oninput="state.user.role=this.value"></div>
    </div>
    <div class="field full"><label>Main Responsibilities</label><textarea rows="2" oninput="state.user.resp=this.value">${u.resp}</textarea></div>
    <h4 style="margin:18px 0 6px;color:var(--navy)">Supervisor / Approver</h4>
    ${supBox}
    <div id="step1err" class="err"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=0;renderRoot()">← กลับ</button>
      <button class="btn" onclick="validateStep1()">ถัดไป →</button>
    </div>
  </div>`;
}

function validateStep1(){
  const u = state.user;
  const missing = [];
  if(!u.bu) missing.push('Business Unit');
  if(!u.country) missing.push('Country');
  if(!u.role) missing.push('Job Role');
  if(!u.supName || !u.supEmail) missing.push('Supervisor Name/Email');
  if(missing.length){ document.getElementById('step1err').textContent = 'กรุณากรอกให้ครบ: ' + missing.join(', '); return; }
  state.step = 2; renderRoot();
}

/* ---- Step 2: Confidentiality ---- */
function renderStep2(){
  const rows = CONFIDENTIAL_FIELDS.map(f=>{
    const val = state.confidential[f];
    return `<tr><td class="qlabel">${f}</td><td><div class="yn">
      <label><input type="radio" name="q_${f}" value="yes" ${val==='yes'?'checked':''} onchange="state.confidential['${f}']='yes'"> Yes</label>
      <label><input type="radio" name="q_${f}" value="no" ${val==='no'?'checked':''} onchange="state.confidential['${f}']='no'"> No</label>
    </div></td></tr>`;
  }).join('');
  return `
  <div class="card">
    <h2 class="sec-title">Section 2.1 — Data Confidentiality Assessment</h2>
    <p class="sec-desc">คำตอบนี้จะกำหนดว่าเครื่องมือ AI แพลตฟอร์มใดที่คุณสามารถใช้ได้</p>
    <table class="qa-table"><tr><th>Data Type</th><th>Yes / No</th></tr>${rows}
      <tr><td class="qlabel">Public Data Only</td><td><div class="yn">
        <label><input type="radio" name="q_public" value="yes" ${state.publicOnly==='yes'?'checked':''} onchange="state.publicOnly='yes'"> Yes</label>
        <label><input type="radio" name="q_public" value="no" ${state.publicOnly==='no'?'checked':''} onchange="state.publicOnly='no'"> No</label>
      </div></td></tr></table>
    <div class="note-box"><strong>Governance Rule:</strong> ถ้าตอบ "Yes" ในข้อมูลลับข้อใดข้อหนึ่ง ระบบจะจำกัดให้ใช้ได้เฉพาะ Copilot Platform เท่านั้น</div>
    <div id="step2err" class="err"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=1;renderRoot()">← กลับ</button>
      <button class="btn" onclick="validateStep2()">ถัดไป →</button>
    </div>
  </div>`;
}
function validateStep2(){
  if(!CONFIDENTIAL_FIELDS.every(f => state.confidential[f])){ document.getElementById('step2err').textContent = 'กรุณาตอบคำถามให้ครบทุกข้อ'; return; }
  state.step = 3; renderRoot();
}

/* ---- Step 3: Activities ---- */
function renderStep3(){
  const byLevel = {1:[],2:[],3:[]};
  ACTIVITIES.forEach(a=>byLevel[a.level].push(a));
  const levelLabel = {1:'Level 1 — Chat, Summarize, Drafting',2:'Level 2 — Enterprise Data Integration',3:'Level 3 — Automation, Agents, Coding'};
  const groups = [1,2,3].map(lvl=>{
    const items = byLevel[lvl].map(a=>{
      const checked = state.activities.includes(a.id) ? 'checked' : '';
      return `<label class="activity-chk"><input type="checkbox" value="${a.id}" ${checked} onchange="toggleActivity('${a.id}')"> ${a.label}</label>`;
    }).join('');
    return `<div class="level-group"><h4>${levelPill(lvl)} ${levelLabel[lvl]}</h4><div class="activity-grid">${items}</div></div>`;
  }).join('');
  return `
  <div class="card">
    <h2 class="sec-title">Section 3 — AI Activities Selection</h2>
    <p class="sec-desc">เลือกกิจกรรมทั้งหมดที่คุณต้องการใช้ AI ช่วยทำงาน</p>
    ${groups}
    <div id="step3err" class="err"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=2;renderRoot()">← กลับ</button>
      <button class="btn" onclick="validateStep3()">วิเคราะห์และแนะนำเครื่องมือ →</button>
    </div>
  </div>`;
}
function toggleActivity(id){
  const idx = state.activities.indexOf(id);
  if(idx>-1) state.activities.splice(idx,1); else state.activities.push(id);
}
function validateStep3(){
  if(state.activities.length===0){ document.getElementById('step3err').textContent = 'กรุณาเลือกกิจกรรมอย่างน้อย 1 ข้อ'; return; }
  state.step = 4; renderRoot();
}

/* ---- Step 4: Recommendation ---- */
function renderStep4(){
  const classification = RE.computeClassification(state.confidential);
  const level = RE.computeLevel(state.activities);
  const { tools, restricted, rawTools } = RE.computeRequiredTools(state.activities, classification);
  const isConf = classification==='confidential';
  const banner = `<div class="result-banner ${isConf?'conf':'nonconf'}"><div class="icon">${isConf?'🔒':'🌐'}</div>
    <div><strong>Data Classification: ${isConf?'Confidential':'Non-Confidential'}</strong><br>
    <span style="font-size:12.5px">${isConf ? 'พบข้อมูลลับ → อนุญาตให้ใช้เฉพาะ Copilot Platform เท่านั้น' : 'ไม่มีข้อมูลลับ → สามารถใช้ Copilot หรือ Claude ได้'}</span></div></div>`;
  const toolCards = tools.map(t=>{
    const reasons = state.activities.map(id=>RE.activityById(id))
      .filter(a => a.tool===t || (restricted && TOOLS[a.tool].platform==='claude' && t==='copilot_cowork'))
      .map(a=>a.label);
    const wasRestricted = restricted && !rawTools.includes(t);
    return `<div class="tool-card ${wasRestricted?'restricted':''}">
      <div><div class="name">${TOOLS[t].name} ${wasRestricted?'<span class="tag tag-dep">ปรับเนื่องจากข้อมูลลับ</span>':''}</div>
      <div class="why">รองรับกิจกรรม: ${reasons.join(', ')}</div></div><div>${levelPill(TOOLS[t].level)}</div></div>`;
  }).join('');
  const restrictedNote = restricted ? `<div class="warn-box">⚠️ บางกิจกรรมโดยปกติแนะนำ Claude แต่มีข้อมูลลับ ระบบจึงแนะนำ Copilot Cowork แทน — หากจำเป็นต้องใช้ Claude จริง ปรึกษาทีม IT/Security</div>` : '';
  const overrideOptions = Object.entries(TOOLS).map(([id,t])=>`<option value="${id}" ${state.overrideTool===id?'selected':''}>${t.name}</option>`).join('');
  return `
  <div class="card">
    <h2 class="sec-title">Section 4 — AI Tool Recommendation</h2>
    ${banner}
    <div style="margin:14px 0"><strong>AI Capability Level:</strong> ${levelPill(level)}</div>
    <h4 style="margin:16px 0 8px;color:var(--navy)">System Recommended Tool(s)</h4>
    ${toolCards}
    ${restrictedNote}
    <h4 style="margin:22px 0 8px;color:var(--navy)">Editable Recommendation</h4>
    <div class="field-row">
      <div class="field"><label>User Preferred Tool</label>
        <select onchange="state.overrideTool=this.value||null; renderRoot()">
          <option value="">-- ใช้คำแนะนำระบบ --</option>${overrideOptions}
        </select></div>
      <div class="field"><label>Reason for Override</label>
        <input type="text" value="${state.overrideReason}" oninput="state.overrideReason=this.value"></div>
    </div>
    ${state.overrideTool && isConf && TOOLS[state.overrideTool].platform==='claude' ? `<div class="warn-box">⚠️ ขัดกับ Governance Rule — จะถูกบังคับส่งขออนุมัติพิเศษ</div>` : ''}
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=3;renderRoot()">← กลับ</button>
      <button class="btn" onclick="state.step=5;renderRoot()">ถัดไป: ขั้นตอนการอนุมัติ →</button>
    </div>
  </div>`;
}

/* ---- Step 5: Approval info ---- */
function renderStep5(){
  const classification = RE.computeClassification(state.confidential);
  const level = RE.computeLevel(state.activities);
  const { tools } = RE.computeRequiredTools(state.activities, classification);
  const approval = RE.computeApproval(level, tools, state.overrideTool, classification);
  let body;
  if(approval.required===true){
    body = `<div class="note-box">🔺 ต้องผ่านการอนุมัติจากหัวหน้างาน/ทีมกำกับดูแล (${state.user.supName})<br><span class="hint">${approval.reason}</span></div>
      <div class="note-box">คำขอนี้จะปรากฏในแท็บ "My Requests / Approvals" ของผู้ที่มีสิทธิ์อนุมัติใน SharePoint List — สิทธิ์นี้ถูกกำหนดโดยแอดมิน SharePoint ไม่ใช่แอปนี้</div>`;
  } else if(approval.required==='optional'){
    body = `<div class="note-box">🔸 AI Level 2 — Optional (Policy Driven)<br><span class="hint">${approval.reason}</span></div>
      <label style="font-size:13px;display:flex;gap:8px;align-items:center;margin-top:8px">
        <input type="checkbox" ${state.policyOverrideAck?'checked':''} onchange="state.policyOverrideAck=this.checked;renderRoot()"> BU ของฉันกำหนดให้ต้องขออนุมัติสำหรับ Level 2</label>
      ${state.policyOverrideAck ? '<div class="note-box">คำขอนี้จะถูกส่งเข้าคิวรออนุมัติ</div>' : '<div class="note-box">✅ ไม่ต้องขออนุมัติ → Auto Approve</div>'}`;
  } else {
    body = `<div class="note-box">✅ Auto Approve — AI Level 1 ไม่ต้องขออนุมัติ<br><span class="hint">${approval.reason}</span></div>`;
  }
  return `
  <div class="card">
    <h2 class="sec-title">Section 5 — Approval Workflow</h2>
    ${body}
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=4;renderRoot()">← กลับ</button>
      <button class="btn" onclick="state.step=6;renderRoot()">ถัดไป: สรุปคำขอ →</button>
    </div>
  </div>`;
}

/* ---- Step 6: Summary & Submit ---- */
function renderStep6(){
  if(state.submitted){
    const s = state.submitted;
    const statusLabel = s.status==='pending' ? 'PENDING (รออนุมัติ)' : 'AUTO-APPROVED';
    const statusClass = s.status==='pending' ? 'pill-pending' : 'pill-auto';
    return `
    <div class="card">
      <h2 class="sec-title">ส่งคำขอสำเร็จ</h2>
      <div class="note-box">✅ บันทึกลง SharePoint แล้ว — Request ID: <strong>${s.id}</strong><br>
        สถานะ: <span class="pill-status ${statusClass}">${statusLabel}</span></div>
      <div class="btn-row"><button class="btn secondary" onclick="resetWizard()">+ สร้างคำขอใหม่</button>
        <button class="btn" onclick="switchToRequests()">ดูใน My Requests →</button></div>
    </div>`;
  }
  const classification = RE.computeClassification(state.confidential);
  const level = RE.computeLevel(state.activities);
  const { tools } = RE.computeRequiredTools(state.activities, classification);
  const approval = RE.computeApproval(level, tools, state.overrideTool, classification);
  const finalTool = state.overrideTool ? toolName(state.overrideTool) : tools.map(toolName).join(' + ');
  const activityLabels = state.activities.map(id=>RE.activityById(id).label).join(', ');
  const approvalRequired = approval.required===true || (approval.required==='optional' && state.policyOverrideAck);
  const rows = [
    ['Requester Information', `${state.user.name} — ${state.user.dept} / ${state.user.bu}`],
    ['Supervisor', `${state.user.supName} (${state.user.supEmail})`],
    ['Data Classification', classification==='confidential'?'Confidential':'Non-Confidential'],
    ['Activities Selected', activityLabels],
    ['AI Capability Level', `Level ${level}`],
    ['Recommended Tool (System)', tools.map(toolName).join(' + ')],
    ['Selected Tool (Final)', finalTool + (state.overrideReason?` — เหตุผล: ${state.overrideReason}`:'')],
    ['Approval Requirement', approvalRequired ? 'Yes' : 'No'],
  ];
  return `
  <div class="card">
    <h2 class="sec-title">Section 6 — Final Summary</h2>
    <p class="sec-desc">ตรวจสอบข้อมูลก่อนส่งคำขอ — จะถูกเขียนลง SharePoint List โดยตรงด้วยบัญชีของคุณ</p>
    <table class="summary-table">${rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
    ${state.submitError ? `<div class="err">${state.submitError}</div>` : ''}
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=5;renderRoot()">← กลับ</button>
      <button class="btn" ${state.submitting?'disabled':''} onclick="submitRequest()">${state.submitting?'กำลังส่ง...':'📩 Submit Request'}</button>
    </div>
  </div>`;
}

async function submitRequest(){
  state.submitting = true; state.submitError = null; renderRoot();
  const classification = RE.computeClassification(state.confidential);
  const level = RE.computeLevel(state.activities);
  const { tools, restricted } = RE.computeRequiredTools(state.activities, classification);
  const approval = RE.computeApproval(level, tools, state.overrideTool, classification);
  const approvalRequired = approval.required===true || (approval.required==='optional' && state.policyOverrideAck);

  const record = {
    id: 'REQ-' + Math.random().toString(16).slice(2,10).toUpperCase(),
    submittedAt: new Date().toISOString(),
    name: state.user.name, email: state.user.email, dept: state.user.dept, bu: state.user.bu,
    country: state.user.country, role: state.user.role, resp: state.user.resp,
    supName: state.user.supName, supEmail: state.user.supEmail, cc: state.user.cc,
    confidential: state.confidential, publicOnly: state.publicOnly,
    activities: state.activities,
    classification, level, recommendedTools: tools, restricted,
    overrideTool: state.overrideTool, overrideReason: state.overrideReason,
    approvalRequired,
    status: approvalRequired ? 'pending' : 'auto-approved',
    decidedBy: null, decidedAt: null, decisionNote: null,
  };
  try{
    await createRequestItem(record);
    state.submitted = record; state.submitting = false; renderRoot();
  }catch(e){
    console.error(e);
    state.submitError = e.status===403
      ? 'บัญชีของคุณไม่มีสิทธิ์เขียนข้อมูลลง SharePoint List นี้ — กรุณาติดต่อผู้ดูแลระบบ'
      : ('ส่งคำขอไม่สำเร็จ: ' + e.message);
    state.submitting = false; renderRoot();
  }
}

function resetWizard(){
  state.step = 1;
  state.confidential = {}; state.publicOnly=null; state.activities=[];
  state.overrideTool=null; state.overrideReason=''; state.policyOverrideAck=false;
  state.submitting=false; state.submitted=null; state.submitError=null;
  renderRoot();
}

/* ======================= My Requests / Approvals ======================= */
async function switchToRequests(){
  state.tab = 'requests';
  renderRoot();
  state.requestsLoading = true; state.requestsError = null;
  renderRoot();
  try{
    state.requests = await listVisibleRequests();
  }catch(e){
    state.requestsError = 'โหลดรายการไม่สำเร็จ: ' + e.message;
  }
  state.requestsLoading = false;
  renderRoot();
}

function renderRequestsTab(){
  if(state.requestsLoading) return `<div class="card">กำลังโหลด...</div>`;
  if(state.requestsError) return `<div class="card"><div class="err">${state.requestsError}</div></div>`;

  const list = state.requests;
  const pending = list.filter(r=>r.status==='pending').length;
  const stats = `<div class="stat-row">
    <div class="stat"><div class="n">${list.length}</div><div class="l">Visible to you</div></div>
    <div class="stat"><div class="n">${pending}</div><div class="l">Pending</div></div>
  </div>
  <div class="perm-note">คุณเห็นเฉพาะคำขอที่บัญชีของคุณมีสิทธิ์เข้าถึงใน SharePoint — ถ้าคุณเป็นผู้อนุมัติ จะเห็นคำขอของทุกคน มิฉะนั้นจะเห็นเฉพาะคำขอของตัวเอง</div>`;

  const rows = list.map(r=>{
    const statusClass = r.status==='approved'?'pill-approved':r.status==='rejected'?'pill-rejected':r.status==='auto-approved'?'pill-auto':'pill-pending';
    const finalTool = r.overrideTool ? toolName(r.overrideTool) : (r.recommendedTools||[]).map(toolName).join(' + ');
    const isExpanded = state.expandedId === r.id;
    let detail = '';
    if(isExpanded){
      const decisionUi = r.status==='pending' ? `
        <div style="margin-top:10px">
          <input type="text" placeholder="หมายเหตุ (ถ้ามี)" style="width:60%" oninput="state.decisionNote['${r.id}']=this.value">
          <button class="btn" onclick="decide('${r._itemId}','${r.id}','approved')">✅ Approve</button>
          <button class="btn danger" onclick="decide('${r._itemId}','${r.id}','rejected')">❌ Reject</button>
        </div>` : `<div class="hint">ตัดสินใจโดย ${r.decidedBy||'-'} เมื่อ ${r.decidedAt?new Date(r.decidedAt).toLocaleString():'-'} ${r.decisionNote?('— '+r.decisionNote):''}</div>`;
      detail = `<tr class="row-detail"><td colspan="8">
        <strong>Supervisor:</strong> ${r.supName} (${r.supEmail})<br>
        <strong>Activities:</strong> ${(r.activities||[]).map(id=>{const a=RE.activityById(id); return a?a.label:id;}).join(', ')}<br>
        <strong>Recommended (system):</strong> ${(r.recommendedTools||[]).map(toolName).join(' + ')} ${r.restricted?'<span class="tag tag-dep">restricted</span>':''}<br>
        ${r.overrideTool ? `<strong>Override:</strong> ${toolName(r.overrideTool)} — ${r.overrideReason||''}<br>` : ''}
        ${decisionUi}
      </td></tr>`;
    }
    return `<tr>
      <td><button class="link-btn" onclick="state.expandedId = state.expandedId==='${r.id}'?null:'${r.id}'; renderRoot()">${r.id}</button></td>
      <td>${new Date(r.submittedAt).toLocaleString()}</td>
      <td>${r.name}<br><span class="hint">${r.dept} / ${r.bu}</span></td>
      <td>${r.classification==='confidential'?'Confidential':'Non-Confidential'}</td>
      <td>${levelPill(r.level)}</td>
      <td>${finalTool}</td>
      <td>${r.approvalRequired?'Yes':'No'}</td>
      <td><span class="pill-status ${statusClass}">${r.status.toUpperCase()}</span></td>
    </tr>${detail}`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--muted)">ไม่มีคำขอ</td></tr>`;

  return `
  <div class="card">
    ${stats}
    ${state.decisionError ? `<div class="err">${state.decisionError}</div>` : ''}
    <div class="btn-row" style="margin-top:0;margin-bottom:14px"><div></div>
      <button class="btn secondary" onclick="exportRequestsToCsv(state.requests)" ${list.length===0?'disabled':''}>⬇ Export CSV</button></div>
    <table class="audit-table">
      <tr><th>Request ID</th><th>Submitted</th><th>Requester</th><th>Classification</th><th>Level</th><th>Final Tool</th><th>Approval Req.</th><th>Status</th></tr>
      ${rows}
    </table>
  </div>`;
}

async function decide(itemId, displayId, decision){
  state.decisionError = null;
  const note = state.decisionNote[displayId] || '';
  try{
    await decideRequest(itemId, decision, note, state.user.name);
    await switchToRequests();
  }catch(e){
    state.decisionError = e.status===403
      ? 'บัญชีของคุณไม่มีสิทธิ์อนุมัติ/ปฏิเสธคำขอ — กรุณาติดต่อทีมกำกับดูแล (ผู้ดูแล SharePoint ต้องเพิ่มคุณในกลุ่ม Approvers)'
      : ('ดำเนินการไม่สำเร็จ: ' + e.message);
    renderRoot();
  }
}

boot();
