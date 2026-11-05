# Author submissions and repository

`/submissions` is an owner-scoped PostgreSQL dashboard with 20-row pages, search,
category/keyword/status filters, dates, confidentiality, type and document counts.
`/submissions/new` saves an explicit draft; `/submissions/{id}` opens details,
metadata editing, attachment progress and lifecycle history. No autosave or offline
private-data cache is introduced. Forms have labels, length bounds and visible
validation/loading feedback. Final submission requires explicit confirmation.

Fields are document/idea, title (1–200 characters), an existing legacy category,
abstract/description (up to 20,000 characters), up to 20 keywords (1–60 characters
each) and confidentiality. Categories reuse the original application, not an
assertion of an authoritative diocesan taxonomy. Type is immutable after creation;
create a different draft if a different type is needed. Ownership and IDs are
server-generated, never accepted as claims from a form.

| Transition         | Actor and requirements                                 | Result                                                                |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Create             | Verified approved account, current repository consent  | Owned draft, version/revision 1, immutable initial snapshot           |
| Save               | Own draft, matching version, valid metadata            | Version increases; immutable snapshot/audit                           |
| Upload             | Own draft of kind document, current eligibility        | Original Phase 3C pending → available/failed lifecycle                |
| Exclude attachment | Own draft, matching version, settled non-excluded file | Excluded flag, version increment, history/audit; bytes retained       |
| Submit             | Own draft, matching version, complete requirements     | Submitted, version increment, timestamp, immutable submitted snapshot |
| Start amendment    | Own returned item, matching version                    | Pre-amendment snapshot, new draft, revision/version increment         |
| Review states      | Future independently authorized workflow               | No accept/return/review decision API in this phase                    |

Final submission requires at least 20 characters of meaningful normalized description.
Documents also require at least one available non-excluded PDF and no non-excluded
pending/failed attachment. Ideas need no file. A failed upload must be explicitly
excluded or reconciled; it is never silently ignored. Pending files cannot be
excluded while I/O may still be running. Available retained attachments may be
carried into an amended revision; exclude old ones and upload replacements when
needed. No bytes/history are overwritten or deleted by author actions.

Atomic SQL functions lock the parent, recheck account/consent/ownership/state/version,
and append ID-only audit and typed lifecycle snapshots (including attachment IDs).
Concurrent saves/submissions have one winner; stale forms return 409. Document
reservation takes a parent SHARE lock; final submission takes UPDATE, so an upload
cannot reserve a new file after a competing successful submit. Finalization locks
and rechecks draft state after slow I/O. No transaction spans upload/download I/O.

Submitted/under-review/accepted metadata and attachments are locked. Existing local
submitted rows stay submitted; there is no automatic conversion/reopening. The
historical SQL default remains submitted for operator compatibility, but the web
runtime cannot INSERT submissions directly: its only creation function explicitly
creates a draft. Reviewers cannot review their own items or any draft. Existing
review decisions remain immutable; private reviewer notes are RLS-restricted to
eligible reviewers of another author's item. Authors receive separate lifecycle
events and a clear future-review-interface notice.

`/repository` and `/repository/{id}` require verified Better Auth identity, approved
account and current repository consent. SQL applies accepted **and non-confidential**
predicates before search, counts or pagination, even for reviewer callers. Categories
are static choices, with no private facets/suggestions/index. Details return explicit
allowed metadata, available non-excluded files and no author/private review history.
Search covers title, description, category and keywords; keyword filtering is exact.
Stable ordering is creation timestamp plus UUID; offset pages may shift when new
accepted items arrive, so reload when the underlying collection changes.

Own confidential/unaccepted records belong in My Submissions, never the shared feed.
Settings-manager and approver capabilities grant no theological-review access.
All PDFs still use `/api/documents/{id}/download`, original live RLS, safe private
filesystem open and mandatory committed pre-transfer audits. No public object URL
or anonymous download is added. Private pages/API responses are no-store, protected
HTML is gated, and the PWA only caches static assets. Lists/details recheck while
open; editing preserves unsaved input while probing live permissions. Revocation
cannot recall previously viewed metadata or bytes already transferred.

Local testing must use disposable accounts and PDFs. The notice is an unapproved
local draft. Signature/trailer checks are not malware scanning or a guarantee of PDF
safety. Real confidential use requires reviewed privacy text, durable quarantine /
malware validation, operational controls and browser/accessibility acceptance tests.
