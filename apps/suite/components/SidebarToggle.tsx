'use client';

// The ☰ button in the header that opens the side panel (components/Sidebar.tsx).
// It turns into ✕ while the panel is open.
export default function SidebarToggle({ open, onToggle, label }: {
  open: boolean;
  onToggle: () => void;
  /** What the panel holds, for screen readers, e.g. "chat list". */
  label: string;
}) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      aria-label={open ? `Close ${label}` : `Open ${label}`}
      aria-expanded={open}
      aria-controls="app-sidebar"
    >
      {open ? '✕' : '☰'}
    </button>
  );
}
