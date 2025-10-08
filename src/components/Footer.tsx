export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Bastet Security. All rights reserved.</span>
      <span>
        Need help? Email <a href="mailto:support@bastet.ai">support@bastet.ai</a>
      </span>
    </footer>
  );
}
