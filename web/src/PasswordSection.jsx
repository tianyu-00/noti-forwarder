import { useState } from "react";
import { api } from "./api.js";
import { Button, inputClass } from "./ui.jsx";

const MIN_LENGTH = 12;

// Changing the password signs out every other browser; this one stays signed in.
export default function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setDone(false);
    if (next.length < MIN_LENGTH) {
      setError(`The new password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== again) {
      setError("The new passwords do not match.");
      return;
    }
    setError(null);
    try {
      await api("/auth/password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      });
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    } catch (err) {
      setError(
        err.body?.error === "wrong_password"
          ? "The current password is not correct."
          : "Could not change the password.",
      );
    }
  }

  return (
    <section
      className="space-y-3 border-t border-line pt-5 text-sm"
      aria-label="Change password"
    >
      <h3 className="text-sm font-semibold">Change password</h3>
      <form onSubmit={submit} noValidate className="space-y-3">
        <label className="block space-y-1.5 font-medium">
          Current password
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5 font-medium">
          New password
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5 font-medium">
          Repeat new password
          <input
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {done && (
          <p className="text-ok">
            Password changed. Other browsers were signed out.
          </p>
        )}
        <Button type="submit">Change password</Button>
      </form>
    </section>
  );
}
