export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 136"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="The Kosher Place"
    >
      {/* THE */}
      <text
        x="4" y="26"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="17"
        fontWeight="700"
        fill="#C8A84B"
        letterSpacing="7"
      >THE</text>

      {/* KOSHER */}
      <text
        x="0" y="104"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="82"
        fontWeight="700"
        fill="#6B1535"
      >KOSHER</text>

      {/* PLACE */}
      <text
        x="199" y="128"
        fontFamily="Georgia, Cambria, 'Times New Roman', serif"
        fontSize="17"
        fontWeight="700"
        fill="#C8A84B"
        letterSpacing="7"
      >PLACE</text>
    </svg>
  )
}
