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
  // ⚠️ This build needs its OWN deployment — do NOT point it at the
  // email-sending build's URL. That backend writes a different last column
  // (MailStatus instead of ApprovalEmailSent) and shares its Sheet, so the two
  // would corrupt each other's worklist. Paste the URL of the deployment you
  // create for THIS copy (README step 3).
  API_URL: 'https://script.google.com/macros/s/AKfycbzV4UAVSKD915a4NHhaFF87qjcqlw7HT_x0vjlcTMohXglcXG23gAdD7PmUMVviGEY7/exec',

  // Shown in the page header. Cosmetic only — change it to whatever suits.
  ORG_NAME: 'Banpu',
};
