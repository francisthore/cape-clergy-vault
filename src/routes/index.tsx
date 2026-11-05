import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import crestAsset from "@/assets/logo-diocese-of-cape-town.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Theological Repository — TEFT, Cape Town" },
      { name: "description", content: "Clergy of the Anglican Diocese of Cape Town register, acknowledge POPIA, and submit theological documents and ideas to the Dean." },
      { property: "og:title", content: "Theological Repository — Anglican Diocese of Cape Town" },
      { property: "og:description", content: "A secure place for clergy to submit documents and ideas to the Dean of Theological Studies." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  ["Register", "Create your clergy account with your title, parish and contact details."],
  ["Acknowledge POPIA", "Read and accept how your personal information is processed before any access is granted."],
  ["Submit", "Upload sermons, papers, liturgical resources, or share ideas with the Dean."],
  ["Review & share", "The Dean reviews each submission; accepted works join the repository for fellow clergy."],
];

function Index() {
  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center">
        <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-full border border-gold/40 bg-crest shadow-sm">
          <img src={crestAsset.url} alt="Coat of arms of the Anglican Diocese of Cape Town" className="h-24 w-auto" />
        </div>
        <p className="mt-7 text-sm font-bold uppercase tracking-[0.16em] text-primary md:text-base">
          Theological Education Formation and Training (TEFT)
        </p>
        <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold leading-snug text-primary md:text-4xl">
          A repository for the theological work of our clergy
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
          Preserve and share sermons, research, liturgical writing and new ideas across the Anglican Diocese of Cape Town — with care for every contributor's privacy under POPIA.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link to="/auth" search={{ view: "register", token: "", error: "" }}>Register as clergy</Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/repository">Browse the repository</Link></Button>
        </div>
      </section>
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-4">
          {steps.map(([t, d], i) => (
            <div key={t}>
              <div className="font-serif text-4xl text-gold">{["I", "II", "III", "IV"][i]}</div>
              <h3 className="mt-2 text-xl font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-muted-foreground">
        Personal information is processed in accordance with the Protection of Personal Information Act 4 of 2013.
      </footer>
    </main>
  );
}
