// The session cookie is Secure (HTTPS only) unless the dashboard is deliberately served over
// plain http:// (a LAN address, no domain). Browsers drop a Secure cookie on http pages, so
// the sign-in would not stick.
export function cookieSecureFor(publicUrl) {
  return !/^http:\/\//i.test(publicUrl);
}
