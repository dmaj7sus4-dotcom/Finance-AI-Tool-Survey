/* AI Tool Request & Assessment Form — public form (no sign-in) */
const RE = window.RecommendationEngine;
const TOOLS = RE.TOOLS;
const ACTIVITIES = RE.ACTIVITIES;
const CONFIDENTIAL_FIELDS = RE.CONFIDENTIAL_FIELDS;

const state = {
  step: 0,
  // Business Unit, Job Role and Cost Center were removed from the form at
  // Samathi's request. The Sheet keeps their columns so older rows stay
  // readable; new rows simply leave them blank.
  user: { name:'', email:'', dept:'', country:'', resp:'',
          supName:'', supEmail:'' },
  confidential: {},
  publicOnly: null,
  activities: [],
  overrideTool: null,
  overrideReason: '',
  policyOverrideAck: false,
  submitting: false,
  submitted: null,
  submitError: null,
  // Sent with the submit so a retry cannot create a second row. Generated once
  // per filled-in form; a new one is issued only after a request is actually
  // filed (see resetWizard), so pressing Submit again after an error still
  // resolves to the same row rather than a duplicate.
  clientKey: newClientKey(),
};

function newClientKey(){
  if (window.crypto && typeof window.crypto.randomUUID === 'function'){
    return window.crypto.randomUUID();
  }
  // Older browsers: still unique enough, since it only has to be unique among
  // this one person's submissions.
  return 'k-' + Date.now().toString(36) + '-' +
         Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

const STEP_TITLES = [
  'AI Tool ที่บริษัทรองรับ','ข้อมูลผู้ใช้งาน','ประเมินความลับของข้อมูล',
  'เลือกกิจกรรมที่ต้องใช้ AI','คำแนะนำเครื่องมือ AI','ขั้นตอนการอนุมัติ','สรุปคำขอ & ส่งคำขอ'
];

function levelPill(level){ return `<span class="lvl-pill lvl-${level}">Level ${level}</span>`; }
function toolName(id){ return TOOLS[id] ? TOOLS[id].name : id; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ======================= BOOT ======================= */
function renderRoot(){
  const root = document.getElementById('root');
  let banner = '';
  if(!API.configured()){
    banner = `<div class="card setup-warn">
      <h3>⚙️ ยังตั้งค่าไม่เสร็จ</h3>
      <p>ระบบยังไม่ได้เชื่อมกับที่เก็บข้อมูล — เปิดไฟล์ <code>config.js</code> แล้วใส่ Web app URL
      ที่ได้จาก Google Apps Script (ดูขั้นตอนที่ 3 ใน README)</p>
      <p class="hint">กรอกฟอร์มดูก่อนได้ตามปกติ แต่จะยังกด Submit ไม่สำเร็จ</p>
    </div>`;
  }
  root.innerHTML = banner + renderWizard();
  window.scrollTo({top:0,behavior:'smooth'});
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
    <div class="tablewrap"><table><tr><th>AI Tool</th><th>Suitable For</th><th>Work Data Access</th><th>Approval</th></tr>${rows}</table></div>
    <div class="btn-row"><div></div><button class="btn" onclick="state.step=1;renderRoot()">เริ่มทำแบบสำรวจ →</button></div>
  </div>`;
}

/* ---- Searchable dropdowns backed by directory.js ----
 * These suggest, they never restrict: anyone not in the directory can still
 * type their details in by hand. Picking someone fills the related fields
 * (name + email + department together) so the three can't disagree.
 * The list updates in place rather than through renderRoot() — a full
 * re-render would steal focus from the box you're typing in.
 */
const DIR = () => (window.DIRECTORY || []);
const DEPTS = () => Array.from(new Set(DIR().map(p => p.d).filter(Boolean))).sort();

function comboMatches(kind, q){
  q = q.trim().toLowerCase();
  if(kind === 'dept'){
    const all = DEPTS();
    return (q ? all.filter(d => d.toLowerCase().includes(q)) : all).slice(0, 60).map(d => ({ d }));
  }
  const all = DIR();
  if(!q) return all.slice(0, 60);
  return all.filter(p =>
    p.n.toLowerCase().includes(q) || p.e.toLowerCase().includes(q) || p.d.toLowerCase().includes(q)
  ).slice(0, 60);
}

function comboInput(kind, el){
  // keep whatever was typed, even if it matches nobody
  if(kind === 'name')     state.user.name = el.value;
  if(kind === 'email')    state.user.email = el.value;
  if(kind === 'dept')     state.user.dept = el.value;
  if(kind === 'supname')  state.user.supName = el.value;
  if(kind === 'supemail') state.user.supEmail = el.value;
  comboOpen(kind, el.value);
}

function comboOpen(kind, q){
  const box = document.getElementById('combo_' + kind);
  if(!box) return;
  const items = comboMatches(kind, q || '');
  if(!items.length){
    box.innerHTML = `<div class="combo-empty">ไม่พบในรายชื่อ — พิมพ์เองได้เลย</div>`;
  } else if(kind === 'dept'){
    box.innerHTML = items.map(i =>
      `<div class="combo-item" onmousedown="comboPickDept(${JSON.stringify(i.d).replace(/"/g,'&quot;')})">${esc(i.d)}</div>`).join('');
  } else {
    box.innerHTML = items.map(p =>
      `<div class="combo-item" onmousedown="comboPick('${kind}','${esc(p.e)}')">
         <span class="ci-name">${esc(p.n)}</span>
         <span class="ci-sub">${esc(p.d)} · ${esc(p.e)}</span>
       </div>`).join('');
  }
  box.classList.add('open');
}

function comboClose(kind){
  // small delay so a click on an item still registers
  setTimeout(() => {
    const box = document.getElementById('combo_' + kind);
    if(box) box.classList.remove('open');
  }, 120);
}

function setVal(id, v){ const el = document.getElementById(id); if(el) el.value = v; }

function comboPick(kind, email){
  const p = DIR().find(x => x.e === email);
  if(!p) return;
  if(kind === 'name' || kind === 'email'){
    state.user.name = p.n; state.user.email = p.e;
    if(p.d) state.user.dept = p.d;
    setVal('f_name', p.n); setVal('f_email', p.e); setVal('f_dept', state.user.dept);
  } else {
    state.user.supName = p.n; state.user.supEmail = p.e;
    setVal('f_supname', p.n); setVal('f_supemail', p.e);
  }
  ['name','email','dept','supname','supemail'].forEach(k => {
    const b = document.getElementById('combo_' + k); if(b) b.classList.remove('open');
  });
  const err = document.getElementById('step1err'); if(err) err.textContent = '';
}

function comboPickDept(d){
  state.user.dept = d;
  setVal('f_dept', d);
  const b = document.getElementById('combo_dept'); if(b) b.classList.remove('open');
}

function combo(kind, id, value, placeholder){
  return `<div class="combo">
    <input type="text" id="${id}" class="combo-input" autocomplete="off" placeholder="${esc(placeholder)}"
           value="${esc(value)}" oninput="comboInput('${kind}', this)"
           onfocus="comboOpen('${kind}', this.value)" onblur="comboClose('${kind}')">
    <div class="combo-list" id="combo_${kind}"></div>
  </div>`;
}

/* ---- Step 1: User info (all manual — no sign-in) ---- */
function renderStep1(){
  const u = state.user;
  const dirNote = DIR().length
    ? `<div class="note-box">🔎 ช่องชื่อ อีเมล แผนก และหัวหน้างาน ค้นหาได้ — พิมพ์บางส่วนของชื่อ อีเมล หรือแผนก
        แล้วเลือกจากรายการ ระบบจะเติมช่องที่เหลือให้อัตโนมัติ (ถ้าไม่มีชื่อคุณในรายการ พิมพ์เองได้ตามปกติ)</div>`
    : '';
  return `
  <div class="card">
    <h2 class="sec-title">Section 2 — ข้อมูลผู้ใช้งาน</h2>
    <p class="sec-desc">กรอกข้อมูลของคุณและหัวหน้างานที่จะเป็นผู้อนุมัติคำขอนี้</p>
    ${dirNote}
    <div class="field-row">
      <div class="field"><label>ชื่อ-นามสกุล <span class="req">*</span></label>
        ${combo('name', 'f_name', u.name, 'พิมพ์เพื่อค้นหาชื่อ...')}</div>
      <div class="field"><label>อีเมล <span class="req">*</span></label>
        ${combo('email', 'f_email', u.email, 'name@banpu.co.th')}</div>
    </div>
    <div class="field-row">
      <div class="field"><label>Department</label>
        ${combo('dept', 'f_dept', u.dept, 'พิมพ์เพื่อค้นหาแผนก...')}</div>
      <div class="field"><label>Country <span class="req">*</span></label>
        <select id="f_country" onchange="state.user.country=this.value">
          <option value="">-- เลือก --</option>
          ${['Thailand','Indonesia','Australia','China','Singapore','Other'].map(c=>`<option ${u.country===c?'selected':''}>${c}</option>`).join('')}
        </select></div>
    </div>
    <div class="field full"><label>Main Responsibilities</label>
      <textarea rows="2" oninput="state.user.resp=this.value">${esc(u.resp)}</textarea></div>

    <h4 style="margin:18px 0 6px;color:var(--navy)">หัวหน้างาน / ผู้อนุมัติ</h4>
    <p class="hint" style="margin:0 0 8px">ทีมกำกับดูแลจะติดต่อหัวหน้างานของคุณตามอีเมลนี้ กรุณาตรวจสอบให้ถูกต้อง</p>
    <div class="field-row">
      <div class="field"><label>ชื่อหัวหน้างาน <span class="req">*</span></label>
        ${combo('supname', 'f_supname', u.supName, 'พิมพ์เพื่อค้นหาชื่อหัวหน้า...')}</div>
      <div class="field"><label>อีเมลหัวหน้างาน <span class="req">*</span></label>
        ${combo('supemail', 'f_supemail', u.supEmail, 'boss@banpu.co.th')}</div>
    </div>
    <div id="step1err" class="err"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=0;renderRoot()">← กลับ</button>
      <button class="btn" onclick="validateStep1()">ถัดไป →</button>
    </div>
  </div>`;
}

function isEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim()); }

/* Section 2.1 answers are keyed by the question's stored key, but the radio
   buttons address questions by index -- the keys contain spaces, '&' and
   brackets, which would need escaping in an inline handler. */
function setConf(i, val){
  const f = CONFIDENTIAL_FIELDS[i];
  if(f) state.confidential[f.key] = val;
}

function validateStep1(){
  const u = state.user;
  const missing = [];
  if(!u.name) missing.push('ชื่อ-นามสกุล');
  if(!u.email) missing.push('อีเมล');
  if(!u.country) missing.push('Country');
  if(!u.supName) missing.push('ชื่อหัวหน้างาน');
  if(!u.supEmail) missing.push('อีเมลหัวหน้างาน');
  const err = document.getElementById('step1err');
  if(missing.length){ err.textContent = 'กรุณากรอกให้ครบ: ' + missing.join(', '); return; }
  if(!isEmail(u.email)){ err.textContent = 'รูปแบบอีเมลของคุณไม่ถูกต้อง'; return; }
  if(!isEmail(u.supEmail)){ err.textContent = 'รูปแบบอีเมลหัวหน้างานไม่ถูกต้อง'; return; }
  state.step = 2; renderRoot();
}

/* ---- Step 2: Confidentiality ---- */
function renderStep2(){
  const rows = CONFIDENTIAL_FIELDS.map((f,i)=>{
    const val = state.confidential[f.key];
    const nm = 'q_' + i;   // index, not the key: keys contain spaces and brackets
    return `<tr><td class="qlabel">
        <div class="qname">${esc(f.label)}</div>
        <div class="qex">${esc(f.examples)}</div>
      </td><td><div class="yn">
      <label><input type="radio" name="${nm}" value="yes" ${val==='yes'?'checked':''} onchange="setConf(${i},'yes')"> Yes</label>
      <label><input type="radio" name="${nm}" value="no" ${val==='no'?'checked':''} onchange="setConf(${i},'no')"> No</label>
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
  const unanswered = CONFIDENTIAL_FIELDS.filter(f => !state.confidential[f.key]);
  if(unanswered.length){
    document.getElementById('step2err').textContent =
      'กรุณาตอบให้ครบทุกข้อ — ยังไม่ได้ตอบ: ' + unanswered.map(f=>f.label).join(', ');
    return;
  }
  if(!state.publicOnly){ document.getElementById('step2err').textContent = 'กรุณาตอบข้อ Public Data Only'; return; }
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
  const { tools, restricted, rawTools } = RE.computeRequiredTools(state.activities, classification);
  const level = RE.computeLevel(state.activities);
  const isConf = classification==='confidential';
  const banner = `<div class="result-banner ${isConf?'conf':'nonconf'}"><div class="icon">${isConf?'🔒':'🌐'}</div>
    <div><strong>Data Classification: ${isConf?'Confidential':'Non-Confidential'}</strong><br>
    <span style="font-size:12.5px">${isConf ? 'ข้อมูลของคุณจัดเป็น Confidential — อนุญาตให้ใช้เฉพาะ Copilot Platform เท่านั้น' : 'ข้อมูลของคุณจัดเป็น Non-Confidential — สามารถใช้ Copilot หรือ Claude ได้'}</span></div></div>`;
  const toolCards = tools.map(t=>{
    const reasons = state.activities.map(id=>RE.activityById(id))
      .filter(a => a.tool===t || (restricted && TOOLS[a.tool].platform==='claude' && t==='copilot_cowork'))
      .map(a=>a.label);
    const wasRestricted = restricted && !rawTools.includes(t);
    return `<div class="tool-card ${wasRestricted?'restricted':''}">
      <div><div class="name">${TOOLS[t].name} ${wasRestricted?'<span class="tag tag-dep">ปรับเนื่องจากข้อมูลลับ</span>':''}</div>
      <div class="why">รองรับกิจกรรม: ${reasons.join(', ')}</div></div><div>${levelPill(TOOLS[t].level)}</div></div>`;
  }).join('');
  const restrictedNote = restricted ? `<div class="warn-box">⚠️ บางกิจกรรมโดยปกติแนะนำ Claude แต่มีข้อมูลลับ ระบบจึงแนะนำ Copilot Cowork แทน — หากจำเป็นต้องใช้ Claude จริง ให้ระบุเหตุผลด้านล่างเพื่อขออนุมัติพิเศษ</div>` : '';
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
        <input type="text" value="${esc(state.overrideReason)}" oninput="state.overrideReason=this.value"></div>
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
    body = `<div class="note-box">🔺 ต้องผ่านการอนุมัติจากหัวหน้างาน/ทีมกำกับดูแล (${esc(state.user.supName)})<br><span class="hint">${approval.reason}</span></div>
      <div class="note-box">เมื่อส่งคำขอแล้ว สถานะจะเป็น <strong>PENDING</strong> — ทีมกำกับดูแลจะรวบรวมคำขอและส่งเรื่องให้หัวหน้างานของคุณพิจารณา</div>`;
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
      <div class="note-box">✅ บันทึกเรียบร้อยแล้ว — Request ID: <strong>${esc(s.id)}</strong><br>
        สถานะ: <span class="pill-status ${statusClass}">${statusLabel}</span></div>
      <p class="hint">บันทึก Request ID นี้ไว้อ้างอิง — ใช้สอบถามสถานะกับทีมกำกับดูแลได้</p>
      <div class="btn-row"><div></div><button class="btn secondary" onclick="resetWizard()">+ สร้างคำขอใหม่</button></div>
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
    ['ผู้ขอ', `${esc(state.user.name)} (${esc(state.user.email)})${state.user.dept ? ' — ' + esc(state.user.dept) : ''}`],
    ['หัวหน้างาน', `${esc(state.user.supName)} (${esc(state.user.supEmail)})`],
    ['Data Classification', classification==='confidential'?'Confidential':'Non-Confidential'],
    ['Activities Selected', activityLabels],
    ['AI Capability Level', `Level ${level}`],
    ['Recommended Tool (System)', tools.map(toolName).join(' + ')],
    ['Selected Tool (Final)', finalTool + (state.overrideReason?` — เหตุผล: ${esc(state.overrideReason)}`:'')],
    ['Approval Requirement', approvalRequired ? 'Yes' : 'No'],
  ];
  return `
  <div class="card">
    <h2 class="sec-title">Section 6 — Final Summary</h2>
    <p class="sec-desc">ตรวจสอบข้อมูลก่อนส่งคำขอ</p>
    <table class="summary-table">${rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
    ${state.submitError ? `<div class="err">${esc(state.submitError)}</div>` : ''}
    <div class="btn-row">
      <button class="btn secondary" onclick="state.step=5;renderRoot()">← กลับ</button>
      <button class="btn" ${state.submitting?'disabled':''} onclick="submitRequest()">${state.submitting?'กำลังส่ง...':'📩 Submit Request'}</button>
    </div>
  </div>`;
}

async function submitRequest(){
  state.submitting = true; state.submitError = null; renderRoot();
  try{
    // Only raw answers go over the wire. The server recomputes classification,
    // level, recommended tools and approval requirement from these before
    // saving, so nothing here can be forged by editing the page.
    const result = await API.call({
      action: 'submit',
      user: state.user,
      confidential: state.confidential,
      publicOnly: state.publicOnly,
      activities: state.activities,
      overrideTool: state.overrideTool || '',
      overrideReason: state.overrideReason,
      policyOverrideAck: !!state.policyOverrideAck,
      clientKey: state.clientKey,
    });
    state.submitted = result;
  }catch(e){
    console.error(e);
    state.submitError = 'ส่งคำขอไม่สำเร็จ: ' + e.message;
  }
  state.submitting = false;
  renderRoot();
}

function resetWizard(){
  state.step = 1;
  state.confidential = {}; state.publicOnly=null; state.activities=[];
  state.overrideTool=null; state.overrideReason=''; state.policyOverrideAck=false;
  state.submitting=false; state.submitted=null; state.submitError=null;
  // A genuinely new request, so it gets its own key.
  state.clientKey = newClientKey();
  renderRoot();
}

renderRoot();
