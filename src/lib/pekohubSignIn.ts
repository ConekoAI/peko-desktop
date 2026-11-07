/**
 * Ask the profile menu to start signing in to PekoHub. The menu owns the
 * sign-in state; other places (a fresh computer's empty chat page) only
 * ask it to begin.
 */
export const PEKOHUB_SIGN_IN_EVENT = "peko:pekohub-sign-in";

export function requestPekohubSignIn() {
  window.dispatchEvent(new Event(PEKOHUB_SIGN_IN_EVENT));
}
