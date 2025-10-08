import { clsx } from 'clsx';
import './Navbar.css';

type NavbarProps = {
  isAuthenticated: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
  loading: boolean;
};

export default function Navbar({ isAuthenticated, onSignOut, onSignIn, loading }: NavbarProps) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <span className="navbar-brand">
          <Logo />
          Bastet Console
        </span>
        <nav className="navbar-links" aria-label="Primary">
          <a href="#about">About</a>
          <a href="#features">Features</a>
          <a href="#administration">Administration</a>
        </nav>
        <button
          type="button"
          className={clsx('cta-button', 'navbar-cta')}
          onClick={isAuthenticated ? onSignOut : onSignIn}
          disabled={loading}
        >
          {loading ? 'Processing…' : isAuthenticated ? 'Sign out' : 'Sign in'}
        </button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#grad)" />
      <path
        d="M24 11c7.18 0 13 5.82 13 13s-5.82 13-13 13-13-5.82-13-13 5.82-13 13-13zm0 6c-3.87 0-7 3.13-7 7s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z"
        stroke="#e0f2fe"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="grad" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
    </svg>
  );
}
