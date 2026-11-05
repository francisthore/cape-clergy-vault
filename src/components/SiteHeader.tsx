import { Link } from "@tanstack/react-router";
import crestAsset from "@/assets/logo-diocese-of-cape-town.png.asset.json";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-crest">
            <img
              src={crestAsset.url}
              alt="Coat of arms of the Anglican Diocese of Cape Town"
              className="h-8 w-auto"
            />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block font-serif text-lg font-semibold">TEFT Repository</span>
            <span className="block text-xs text-muted-foreground">
              Theological Education Formation and Training
            </span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <a href="/account" className="rounded px-3 py-2 hover:bg-accent">
            My account
          </a>
          <a href="/auth?view=login" className="rounded px-3 py-2 hover:bg-accent">
            Sign in
          </a>
          <a href="/auth?view=register" className="rounded px-3 py-2 hover:bg-accent">
            Register
          </a>
        </nav>
      </div>
    </header>
  );
}
