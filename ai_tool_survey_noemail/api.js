/**
 * Thin wrapper around the Google Apps Script web app.
 *
 * Requests go out as GET with everything packed into one ?payload=<json>
 * parameter, NOT as POST. That is deliberate and worth not "fixing":
 *
 * A POST to /exec answers with a 302 to script.googleusercontent.com/macros/echo,
 * and for a cross-origin browser request that second hop is unreliable — it
 * intermittently returns a 404 HTML page even when the script itself completed
 * successfully (confirmed against the execution log: doPost finished in 1.3s
 * with status "completed" while the browser received 404). Sometimes it instead
 * replays the doGet output, so a submit would come back looking like a health
 * check. The GET path does not suffer from that.
 *
 * Note the absence of custom headers: without them the request stays a CORS
 * "simple request", so the browser skips the preflight OPTIONS call — which
 * Apps Script cannot answer.
 *
 * On top of that there is a small retry, because Google's front end does
 * occasionally hiccup on the first call after the script has been idle.
 */
const API = {
  MAX_ATTEMPTS: 3,

  configured() {
    const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url);
  },

  async call(payload) {
    if (!this.configured()) {
      throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js — ดูขั้นตอนที่ 3 ใน README');
    }

    const base = window.APP_CONFIG.API_URL;
    const url = base + '?payload=' + encodeURIComponent(JSON.stringify(payload));
    let lastError = null;

    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      try {
        return await this._once(url);
      } catch (err) {
        lastError = err;
        if (err.fatal) throw err;               // a real server-side refusal
        if (attempt < this.MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 800 * attempt));
        }
      }
    }
    throw lastError;
  },

  async _once(url) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', redirect: 'follow' });
    } catch (err) {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบว่า Deploy แบบ "Anyone" แล้ว และ API_URL ถูกต้อง');
    }
    if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ')');

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // Almost always Google's own HTML error/sign-in page rather than our JSON.
      throw new Error('เซิร์ฟเวอร์ไม่ได้ตอบเป็นข้อมูล — มักเกิดจากตอน Deploy ตั้ง "Who has access" ไม่ใช่ Anyone');
    }
    if (!data.ok) {
      // The script answered and said no — retrying will not change that.
      const err = new Error(data.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
      err.fatal = true;
      throw err;
    }
    return data;
  },
};
