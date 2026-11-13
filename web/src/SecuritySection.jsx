import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "./api.js";
import { Button, inputClass } from "./ui.jsx";

// Two-step login (an authenticator app). Steps: off -> scan and confirm -> save backup codes -> on.
export default function SecuritySection() {
  const [enabled, setEnabled] = useState(null); // null while loading
  const [step, setStep] = useState("idle"); // idle | scan | codes | disabling
  const [setup, setSetup] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let stale = false;
    api("/auth/me")
      .then((me) => {
        if (!stale) setEnabled(Boolean(me.totpEnabled));
      })
      .catch(() => {
        if (!stale) setError("Could not load the two-step login status.");
      });
    return () => {
      stale = true;
    };
  }, []);

  function reset(next = "idle") {
    setStep(next);
    setCode("");
    setPassword("");
    setError(null);
  }

  async function begin() {
    setError(null);
    try {
      setSetup(await api("/auth/totp/setup", { method: "POST", body: {} }));
      reset("scan");
    } catch {
      setError("Could not start the setup.");
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError(null);
    try {
      const done = await api("/auth/totp/enable", {
        method: "POST",
        body: { code: code.trim() },
      });
      setBackupCodes(done.backupCodes);
      setSetup(null);
      reset("codes");
    } catch {
      setError(
        "That code was not correct. Check the code in your app and try again.",
      );
    }
  }

  async function turnOff(e) {
    e.preventDefault();
    setError(null);
    try {
      await api("/auth/totp/disable", {
        method: "POST",
        body: { password, code: code.trim() },
      });
      setEnabled(false);
      reset("idle");
    } catch {
      setError("The password or code was not correct.");
    }
  }

  if (enabled === null) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : null;
  }

  const input = inputClass;
  return (
    <section
      className="space-y-4 border-t border-line pt-5 text-sm"
      aria-label="Two-step login"
    >
      <h3 className="text-sm font-semibold">Two-step login</h3>

      {step === "idle" && (
        <>
          <p className="text-muted">
            {enabled ? "Two-step login is on." : "Two-step login is off."}
          </p>
          {enabled ? (
            <Button variant="secondary" onClick={() => reset("disabling")}>
              Turn off
            </Button>
          ) : (
            <Button onClick={begin}>Turn on</Button>
          )}
        </>
      )}

      {step === "scan" && setup && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-muted">
            Scan this with an authenticator app (Google Authenticator, Authy,
            1Password…), then enter the code it shows.
          </p>
          <div className="inline-block rounded-lg border border-line bg-white p-2">
            <QRCodeSVG
              value={setup.otpauthUri}
              size={160}
              role="img"
              aria-label="Authenticator QR code"
            />
          </div>
          <p className="text-muted">
            Or type this key into the app:{" "}
            <span className="select-all break-all font-mono text-fg">
              {setup.secret}
            </span>
          </p>
          <label className="block space-y-1.5 font-medium">
            6-digit code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className={input}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit">Confirm</Button>
            <Button variant="secondary" onClick={() => reset("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step === "codes" && (
        <div className="space-y-3">
          <p className="text-muted">
            Two-step login is on. Save these backup codes now. Each works once
            if you lose your phone, and they are not shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-surface p-3 font-mono text-fg">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setBackupCodes([]);
              setEnabled(true);
              reset("idle");
            }}
          >
            I have saved them
          </Button>
        </div>
      )}

      {step === "disabling" && (
        <form onSubmit={turnOff} className="space-y-3">
          <p className="text-muted">
            Enter your password and a current code (or a backup code) to turn it
            off.
          </p>
          <label className="block space-y-1.5 font-medium">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={input}
            />
          </label>
          <label className="block space-y-1.5 font-medium">
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              className={input}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger">
              Confirm turn off
            </Button>
            <Button variant="secondary" onClick={() => reset("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
