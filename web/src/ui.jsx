// The few building blocks every screen shares, so buttons and dialogs look and behave the same.
import PropTypes from "prop-types";
import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";

const VARIANTS = {
  primary: "bg-primary text-on-primary hover:opacity-90",
  secondary: "border border-line bg-bg text-fg hover:bg-raised",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-muted hover:bg-raised hover:text-fg",
};

export function Button({
  variant = "primary",
  type = "button",
  className,
  ...props
}) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

Button.propTypes = {
  variant: PropTypes.oneOf(["primary", "secondary", "danger", "ghost"]),
  type: PropTypes.string,
  className: PropTypes.string,
};

// Without a width, so a field can size itself (a search box that stretches, a short select).
export const fieldClass =
  "rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint";
export const inputClass = `w-full ${fieldClass}`;

/** Standard dialog: centred card, a title, a short line of help, and one Close button. */
export function Modal({ open, onOpenChange, title, description, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-5 overflow-y-auto rounded-xl border border-line bg-bg p-6 text-fg shadow-xl">
          <div className="space-y-1">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted">
              {description}
            </Dialog.Description>
          </div>
          {children}
          <Dialog.Close asChild>
            <Button variant="secondary" className="w-full">
              Close
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

Modal.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  children: PropTypes.node,
};
