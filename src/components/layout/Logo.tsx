export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 150"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="The Kosher Place"
      dir="ltr"
    >
      {/* THE */}
      <text
        x="6" y="30"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="19"
        fontWeight="700"
        fill="#C8A84B"
        letterSpacing="8"
      >THE</text>

      {/* KOSHER */}
      <text
        x="2" y="118"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="90"
        fontWeight="700"
        fill="#6B1535"
      >KOSHER</text>

      {/* PLACE */}
      <text
        x="250" y="143"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="19"
        fontWeight="700"
        fill="#C8A84B"
        letterSpacing="8"
      >PLACE</text>
    </svg>
  )
}
