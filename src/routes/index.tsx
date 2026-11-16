import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Crest } from "@/components/branding/Crest";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Theological Repository — TEFT, Cape Town" },
      {
        name: "description",
        content:
          "Clergy of the Anglican Diocese of Cape Town register, acknowledge POPIA, and submit theological documents and ideas to the Dean.",
      },
      { property: "og:title", content: "Theological Repository — Anglican Diocese of Cape Town" },
      {
        property: "og:description",
        content:
          "A secure place for clergy to submit documents and ideas to the Dean of Theological Studies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  ["Register", "Create your clergy account with your title, parish and contact details."],
  ["Acknowledge POPIA", "Read and acknowledge the privacy notice before any access is granted."],
  ["Submit", "Upload sermons, papers, liturgical resources, or share ideas with the Dean."],
  [
    "Review & share",
    "Assigned TEFT reviewers assess submissions; accepted non-confidential works can join the clergy repository.",
  ],
];

function Index() {
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-12 md:grid-cols-[1fr_auto] md:py-16">
        <div>
          <p className="eyebrow">Anglican Diocese of Cape Town</p>
          <h1 className="max-w-2xl text-4xl font-semibold text-primary md:text-5xl">
            Theological work,
            <br />
            shared with care.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            A home for the sermons, research, liturgical writing and ideas of our clergy. Contribute
            your work to TEFT and discover resources for your ministry.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth" search={{ view: "register", token: "", error: "" }}>
                Register as clergy
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/repository">Browse the repository</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Already registered?{" "}
            <a className="text-primary underline underline-offset-4" href="/auth?view=login">
              Sign in to your account
            </a>
          </p>
        </div>
        <div className="hidden justify-center md:flex">
          <Crest size="hero" />
        </div>
      </section>
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 md:grid-cols-4">
          {steps.map(([t, d], i) => (
            <div key={t}>
              <div className="text-sm font-semibold text-gold">{["I", "II", "III", "IV"][i]}</div>
              <h3 className="mt-2 text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-muted-foreground">
        Personal information is processed in accordance with the Protection of Personal Information
        Act 4 of 2013.
      </footer>
    </main>
  );
}
