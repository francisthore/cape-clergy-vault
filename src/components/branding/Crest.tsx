export function Crest({ size = "header" }: { size?: "header" | "hero" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-gold/30 bg-crest ${size === "hero" ? "h-36 w-36" : "h-12 w-12"}`}
    >
      <img
        src="/dct-crest-header.png"
        width="140"
        height="192"
        alt="Coat of arms of the Anglican Diocese of Cape Town"
        className={`w-auto object-contain ${size === "hero" ? "h-28" : "h-10"}`}
      />
    </span>
  );
}
