import { useSyncExternalStore } from "react";
import { isValidKey } from "./e2e.js";

// The end-to-end encryption key lives only in this browser (localStorage). It is never sent to
// the server. Another browser needs the key typed in once (Settings shows it for that).
const STORAGE_KEY = "nf_e2e_key";
const listeners = new Set();
let memory = null; // used when localStorage is blocked, for this tab only

function read() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function write(value) {
  memory = value;
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // blocked storage: the key stays in memory until the tab closes
  }
  listeners.forEach((fn) => fn());
}

export function getKey() {
  const key = read();
  return key && isValidKey(key) ? key : null;
}

export function setKey(key) {
  if (!isValidKey(key)) throw new Error("That is not a valid encryption key.");
  write(key);
}

export function clearKey() {
  write(null);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useE2eKey() {
  return useSyncExternalStore(subscribe, getKey);
}
