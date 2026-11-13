import { useState } from "react";
import { clearKey, setKey, useE2eKey } from "./keyStore.js";
import { generateKey } from "./e2e.js";
import { Button, inputClass } from "./ui.jsx";

// End-to-end encryption: phones encrypt the sender and text with a key that only the phones and
// the browsers hold, so the server stores scrambled text it cannot read.
export default function EncryptionSection() {
  const key = useE2eKey();
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(null);
  const [confirmingOff, setConfirmingOff] = useState(false);

  function turnOn() {
    setKey(generateKey());
    setError(null);
  }

  function saveTyped(e) {
    e.preventDefault();
    try {
      setKey(typed.trim());
      setTyped("");
      setError(null);
    } catch {
      setError("That is not a valid encryption key.");
    }
  }

  function forget() {
    clearKey();
    setShown(false);
    setConfirmingOff(false);
  }

  return (
    <section
      className="space-y-3 border-t border-line pt-5 text-sm"
      aria-label="End-to-end encryption"
    >
      <h3 className="text-sm font-semibold">End-to-end encryption</h3>
      <p className="text-muted">
        Phones encrypt the sender and text before sending, so the server stores
        scrambled text it cannot read. Only this browser and your phones hold
        the key. A phone must be paired again to start encrypting. Searching and
        code detection then happen in the browser, and push alerts carry no
        text.
      </p>

      {key ? (
        <>
          <p>End-to-end encryption is on in this browser.</p>
          {shown && (
            <p className="select-all break-all rounded-md border border-line bg-surface p-3 font-mono">
              {key}
            </p>
          )}
          <p className="text-muted">
            To read messages in another browser, open Settings there and paste
            this key. Keep it safe: nobody can recover it, and without it
            encrypted messages cannot be read.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShown((s) => !s)}>
              {shown ? "Hide key" : "Show key"}
            </Button>
            {!confirmingOff && (
              <Button
                variant="secondary"
                onClick={() => setConfirmingOff(true)}
              >
                Forget key
              </Button>
            )}
          </div>
          {confirmingOff && (
            <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <p>
                This browser forgets the key. Messages encrypted with it cannot
                be read here until you paste the key again. Phones keep
                encrypting until they are paired again.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" onClick={forget}>
                  Yes, forget the key
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingOff(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p>End-to-end encryption is off.</p>
          <Button onClick={turnOn}>Create key</Button>
          <form onSubmit={saveTyped} className="space-y-3" noValidate>
            <label className="block space-y-1.5 font-medium">
              Already have a key from another browser?
              <span className="sr-only"> Encryption key</span>
              <input
                aria-label="Encryption key"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} font-mono`}
              />
            </label>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="secondary">
              Use this key
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
