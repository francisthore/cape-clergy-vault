export const submissionHelp =
  "You can save your work and return later. Your submission will only be sent for theological review when you choose Send to TEFT for review.";
export const submissionStatusLabel = (status: string) =>
  ({
    draft: "Not yet submitted",
    submitted: "Sent to TEFT for review",
    under_review: "Theological review in progress",
    accepted: "Accepted for sharing where permitted",
    returned: "Returned for revision",
  })[status] ?? status.replaceAll("_", " ");
export const lifecycleLabel = (event: string) =>
  ({
    created: "Submission started",
    saved: "Submission saved",
    draft_created: "Submission started",
    draft_saved: "Submission saved",
    amended: "Revision started",
    submitted: "Sent to TEFT for review",
  })[event] ?? event.replaceAll("_", " ");
