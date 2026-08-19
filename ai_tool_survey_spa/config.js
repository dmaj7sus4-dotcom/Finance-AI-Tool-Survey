/**
 * The one thing you have to fill in.
 *
 * API_URL is the "Web app URL" that Google gives you at the end of
 * README.md step 3 (Deploy > New deployment > Web app). It looks like:
 *   https://script.google.com/macros/s/AKfycb..................../exec
 *
 * This URL is not a secret — it only accepts the actions this app sends, and
 * anything admin-related is refused without the admin password, which lives
 * inside the script on Google's side and never reaches the browser.
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzrTqwiJu-tKEwizOZG9TakVfrcIhgj6G6tTK1Y0zjONor-dO1dCSJotgMsakdMf2Vr/exec',

  // Shown in the page header. Cosmetic only — change it to whatever suits.
  ORG_NAME: 'Banpu',
};
