/**
 * Thin wrapper around the Google Apps Script web app.
 *
 * Note the deliberate absence of any custom headers: a POST with no headers
 * set is a CORS "simple request", so the browser skips the preflight OPTIONS
 * call. Apps Script web apps can't answer a preflight, so adding something
 * like `Content-Type: application/json` here would break every call with a
 * CORS error. The body is still JSON — Apps Script parses e.postData.contents
 * regardless of the declared content type.
 */
const API = {
  configured() {
    const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url);
  },

  async call(payload) {
    if (!this.configured()) {
      throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js — ดูขั้นตอนที่ 3 ใน README');
    }
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        redirect: 'follow',
      });
    } catch (err) {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบว่า Deploy แบบ "Anyone" แล้ว และ API_URL ถูกต้อง');
    }
    if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ')');

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // Almost always means the deployment is set to "Only myself" and Google
      // returned an HTML sign-in page instead of our JSON.
      throw new Error('เซิร์ฟเวอร์ไม่ได้ตอบเป็นข้อมูล — มักเกิดจากตอน Deploy ตั้ง "Who has access" ไม่ใช่ Anyone');
    }
    if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
    return data;
  },
};
