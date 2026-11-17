# Pilot security maintenance — prepared owner procedure

Phase 4.3.1, 17 November 2026. Read [reviewer operations](reviewer-operations.md)
before maintenance. No step below was executed against the persistent database except
read-only inventory. No worker with a real provider key was invoked or restarted.

## Current evidence and persistent migration

The protected development target has 39 migrations including 0038. The read-only
inventory verifies each applied hash in order, reports the pending migration names
and checks the confidentiality gate. It emits aggregates only:

```sh
npm run db:pilot:inventory
```

Current result: 0038 reservation gate present, 0039 pending; two currently confidential
PDF records have Bouncer scan IDs; no current exhausted/held records. These are
potential earlier transfers, not a determination that real personal information was
transferred unlawfully. Do not disclose identifiers, private filenames, provider
responses or documents in ordinary reports. Preserve evidence. The responsible office
must determine real versus synthetic data, classification at the time, authorization,
provider copies and any response duties. Do not contact the provider or notify third
parties without the relevant authorization. No change can recall transferred bytes.

Owner-approved sequence for the persistent database:

1. Review the exact diff of `0039_pilot_authorization_fences.sql` and the current
   migration plan. It must show only that reviewed migration pending. Any hash drift,
   unexpected migration or newer database blocks the procedure. Retain a protected
   copy/reference of current aggregate evidence and the reviewed SQL hash.
2. Quiesce this application's web mutations and scanner/mail loops through their
   existing authorized controls; do not alter other projects. In particular do not
   restart the real Bouncer worker to test the fix. Coordinate a database/private-file
   backup and preserve histories, jobs, budgets and invitation recovery material.
3. Only after owner authorization to mutate this database, run the existing guarded
   `npm run db:migrate` from the reviewed checkout. This is an additive forward change;
   never modify migration 0038, overwrite the ledger, reset data or disable a trigger.
   No new real capability is granted and no existing valid assignment is revoked.
4. Re-run `db:pilot:inventory`, `db:audit:phase3e` and `db:audit:phase3f` read-only after
   a current build. Expect 40 matching migration hashes, the classification fence and
   exact reviewed grants/RLS/triggers. An audit failure blocks service exposure; do not
   broaden grants to repair it. Preserve captures and immutable evidence.
5. The new web factory refuses a missing 0039 fence. Demonstrate with synthetic
   accounts only. A real worker restart additionally requires verified safe DB state,
   a separate provider-processing authorization and review of existing provider jobs.
   Migration success is not permission for real external processing.

## Authorization policy after 0039

A manager cannot invite themselves as reviewer. Another authorized access manager
must independently verify the exact registered identity, issue the one-hour invitation
and record the reason. Recipient proof and authenticated acceptance remain necessary.
Previously pending self-issued proof cannot activate a reviewer. Existing accepted
reviewer grants and assignments remain intact; do not retrospectively erase evidence.
Emergency owner tooling is trusted maintenance, not a single-person approval substitute;
independent human authorization must be recorded before its use.

A separately activated reviewer/coordinator can explicitly assign themselves to another
author's non-confidential exact revision. Confidential work needs a different authorized
coordinator to assign an already eligible reviewer. Assigning confers no content access
on the coordinator. Self-review, stale revisions, expired/revoked eligibility and
unassigned access fail at SQL/RLS/HTTP boundaries. A one-administrator pilot cannot
review confidential work until an appropriate second person participates.

A non-confidential draft cannot be relabelled confidential once external screening has
been initiated for any of its PDFs, including excluded historical attachments. This
fences the interval between committed reservation and upload, including stale
repeatable-read snapshots. Create a separate confidential draft without a PDF and
contact TEFT. Never remove confidentiality merely to get a PDF screened.

## Screening limits and reconciliation

Trusted web setting `CAPE_SCREENING_MAX_BYTES` defaults to 4,194,304 bytes. The hard
boundary remains 20,971,520 bytes. Both declared and actual streamed bytes are checked;
client values cannot raise either server limit. Confidential PDFs are blocked regardless
of this setting. Authors see screening-specific guidance rather than a malware verdict.
Known oversized/confidential attempts do not create upload rows or external reservations.

Do not raise the operational limit until the worker's exact Bouncer host, TLS/no-redirect
behavior, temporary credential handling and live v2 contract have separately authorized
synthetic acceptance evidence. Check the same deployment's worker/web settings together.
No example invents a bucket. Existing accepted IDs may poll; neither restart nor
configuration change reuploads their bytes. Confidential jobs lacking provider acceptance
stay unverified. A missing-ID `submitting` marker becomes held/ambiguous, never a fresh POST.
Historical confidential Bouncer clean results remain evidence but cannot satisfy the
clean authorization predicate or either pre-transfer audit, so they cannot release bytes.

Held-job procedure (no automatic mutation/retry command is supplied):

1. Use the protected read-only owner inventory/report; record aggregate categories and
   an internal incident/change reference. Under restricted authority inspect exact job
   IDs, hashes, timestamps, lease/scan events, provider-ID and reservation markers.
   Keep this detail outside ordinary logs and public documents.
2. Preserve the object and immutable evidence. Distinguish no-attempt configuration
   holds from accepted IDs, uncertain database checkpoints and ambiguous provider
   submissions. Confirm no live lease/worker overlaps the investigation.
3. Accepted ID: use that ID's existing poll path where still eligible. Missing, expired
   or deleted provider evidence never establishes clean status and never authorizes
   another upload. Reconcile with provider history only within an approved window.
4. Ambiguous acceptance: keep held. Do not clear IDs/markers, decrement budget counters,
   reset attempts, replay upload credentials or issue a replacement automatically.
   Owner/privacy authority must assess any later independently authorized action.
5. For conclusively unattempted configuration holds, first repair/verify the approved
   configuration. An author may deliberately replace the excluded held attachment
   through the normal new-upload workflow only after operator review confirms no prior
   provider submission. Old rows/events remain; no job or quota history is erased.
6. Record the decision and responsible authority. Any future requeue API must be
   separately reviewed with immutable evidence and provider-ambiguity safeguards.

The inventory found no held/exhausted jobs at this snapshot; that does not prove that
historical holds never occurred. Provider exactly-once billing is not promised: Bouncer
has no verified submission idempotency contract. Within a recorded upload intent the
worker persists the acceptance marker/ID and never automatically repeats an uncertain
POST. A new author upload is a different deliberate intent and needs the review above
when replacing a held attachment.
