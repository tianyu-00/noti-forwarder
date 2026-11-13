import PropTypes from "prop-types";
import PasswordSection from "./PasswordSection.jsx";
import SecuritySection from "./SecuritySection.jsx";
import { Modal } from "./ui.jsx";

// Things about the signed-in account: how you sign in. Dashboard-wide options are in Settings.
export default function AccountDialog({ open, onOpenChange }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Account"
      description="How you sign in to this dashboard."
    >
      <PasswordSection />
      <SecuritySection />
    </Modal>
  );
}

AccountDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
};
