// Inline so the stroke follows the active theme's --brand-mark (set on .carby-brand). The
// surrounding link carries the accessible name.
export function CarbyWordmark() {
  return (
    <svg
      viewBox="0 0 180 64"
      width={135}
      height={48}
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M37 15C32 10 27 9 23 9C12 9 5 17 5 29S12 49 23 49C28 49 33 47 37 43M73 26V48M73 36C73 29 69 24 62 24S50 29 50 36S55 49 62 49S73 44 73 36M87 48V26M87 34C89 27 94 24 101 25M113 10V48M113 36C113 29 118 24 125 24S137 29 137 36S132 49 125 49S113 44 113 36M149 25L160 47M174 25L160 53C158 57 155 59 150 59" />
    </svg>
  );
}
