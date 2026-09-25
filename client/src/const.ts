import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS };

// Send the browser to the local login page. Standalone deployment — this
// used to redirect out to Manus's own OAuth portal (VITE_OAUTH_PORTAL_URL);
// there's no external identity provider anymore, so this just navigates to
// our own /login route.
export const startLogin = () => {
  window.location.href = "/login";
};
