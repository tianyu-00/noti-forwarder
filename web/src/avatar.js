// The round badge beside a conversation: the first letter of its name on a tint that stays the
// same for that name. Android only gives us package names (com.parcels.app), so the common
// prefixes are skipped to reach the part that names the app.
const PREFIXES = new Set(["com", "org", "net", "io", "co", "app", "android"]);

export function avatarInitial(name) {
  const parts = name.split(".").filter(Boolean);
  const word =
    name.includes(".") && !name.includes(" ")
      ? (parts.find((p) => !PREFIXES.has(p.toLowerCase())) ?? parts[0] ?? "")
      : name.trim();
  return word ? [...word][0].toUpperCase() : "?";
}

/** 1 to 6, the same for the same name. Matches the --av1…--av6 colours in index.css. */
export function avatarTone(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return (hash % 6) + 1;
}
