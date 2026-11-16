export const OTP_FRESH_SECONDS = 600;

/** True when the session was established by an emailed one-time code within the last 10 minutes. */
export function isFreshOtp(amr: unknown, nowSec: number): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some(
    (a: { method?: string; timestamp?: unknown } | null) =>
      !!a &&
      ["otp", "magiclink"].includes(a.method ?? "") &&
      typeof a.timestamp === "number" &&
      nowSec - a.timestamp <= OTP_FRESH_SECONDS,
  );
}

export const SIGNED_URL_SECONDS = 60;

export const DENIED_THRESHOLD = 3; // denials per actor per hour
export const DOWNLOAD_THRESHOLD = 15; // downloads per actor per hour

type Ev = {
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  outcome: string;
  submission_id: string | null;
};
export type Alert = {
  kind: "repeated_denials" | "unusual_downloads";
  actorId: string | null;
  actorEmail: string | null;
  count: number;
  first: string;
  last: string;
  submissionIds: string[];
};

/** Flags actors exceeding thresholds within the last hour. Alerts carry only IDs and counts, never submission content. */
export function detectAlerts(events: Ev[], nowMs: number): Alert[] {
  const recent = events.filter((e) => nowMs - new Date(e.at).getTime() <= 3600_000);
  const group = (pred: (e: Ev) => boolean, kind: Alert["kind"], min: number) => {
    const m = new Map<string, Ev[]>();
    for (const e of recent.filter(pred)) {
      const k = e.actor_id ?? "unknown";
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.values()]
      .filter((l) => l.length >= min)
      .map((l) => {
        const ts = l.map((e) => e.at).sort();
        return {
          kind,
          actorId: l[0]!.actor_id,
          actorEmail: l[0]!.actor_email,
          count: l.length,
          first: ts[0]!,
          last: ts[ts.length - 1]!,
          submissionIds: [...new Set(l.map((e) => e.submission_id).filter(Boolean) as string[])],
        };
      });
  };
  return [
    ...group((e) => e.outcome === "denied", "repeated_denials", DENIED_THRESHOLD),
    ...group(
      (e) => e.action === "download" && e.outcome === "ok",
      "unusual_downloads",
      DOWNLOAD_THRESHOLD,
    ),
  ];
}
