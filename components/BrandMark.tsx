export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="16" fill="#0B1720" />
      <circle cx="32" cy="32" r="7" fill="#0F8F7B" />
      <circle cx="32" cy="32" r="14" stroke="#0F8F7B" strokeOpacity="0.85" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="21" stroke="#0F8F7B" strokeOpacity="0.35" strokeWidth="2" />
      <path
        d="M18 40c4.5 5 10 7.5 14 7.5S41.5 45 46 40"
        stroke="#D7F3EE"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}
