import { useState } from "react";
import PropTypes from "prop-types";
import { api } from "./api.js";
import { Button, Modal } from "./ui.jsx";

// Deletes every phone's messages. The phones stay paired and keep sending.
export default function ClearAllDialog({ open, onOpenChange, onCleared }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function change(next) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function clearAll() {
    setError(null);
    setBusy(true);
    try {
      await api("/messages", { method: "DELETE" });
      onCleared();
      change(false);
    } catch {
      setError("Could not clear the messages.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title="Clear all messages"
      description="Removes messages from every phone."
    >
      <div className="space-y-4 text-sm">
        <p>
          Delete the messages of every phone? The phones stay paired and keep
          sending. This cannot be undone.
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="danger" onClick={clearAll} disabled={busy}>
            Yes, clear
          </Button>
          <Button variant="secondary" onClick={() => change(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ClearAllDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onCleared: PropTypes.func.isRequired,
};
