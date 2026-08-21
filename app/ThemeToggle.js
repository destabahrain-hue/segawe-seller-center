'use client';
import { useEffect, useState } from 'react';

const KEY = 'nsc.theme';
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = localStorage.getItem(KEY) === 'dark';
    setDark(t);
    document.documentElement.setAttribute('data-theme', t ? 'dark' : 'light');
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    localStorage.setItem(KEY, next ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
  }
  return (
    <button className="btn btn-sm" onClick={toggle} aria-label="Ganti mode terang atau gelap" title="Mode terang / gelap">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {dark
          ? <><circle cx="12" cy="12" r="4.6" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></>
          : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      </svg>
    </button>
  );
}
