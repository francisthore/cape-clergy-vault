# Human accessibility and physical-device acceptance

**Pending: no human screen-reader, physical-device, zoom or forced-colors acceptance
was performed by this agent.** Automated Chromium/axe and viewport checks are separate
evidence and do not establish complete WCAG compliance. Use only disposable accounts,
capture-only email and synthetic PDFs; never real clergy or confidential test content.

For each run record tester (only when designated), date, OS/device, browser/assistive-
technology version, viewport/zoom, scenario, expected result, observed result, issue
reference, retest reference and actual acceptance decision. Current tester/date/
observed/evidence fields are all Pending. No automatic sign-off follows a passing axe
scan. Suggested participants/tools: NVDA with supported Windows browser, VoiceOver
on macOS/iPhone, TalkBack on Android and keyboard-only users.

| Scenario / action                      | Expected result                                                                                                          | Current human result |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Keyboard-only registration/login/reset | every field/action reachable in logical order; no keyboard trap; generic mail/errors understandable                      | Pending              |
| Visible focus/navigation               | clear focus for links, controls, menus and skip/navigation paths in all states                                           | Pending              |
| Dialog accept/return/approval          | initial focus sensible; Tab/Shift-Tab trapped; Escape/cancel appropriate; focus returns to trigger                       | Pending              |
| Screen-reader route/status changes     | labels, heading order, landmark and pending/error/success announcements understandable without sight                     | Pending              |
| Validation/conflict feedback           | errors associated with fields; focus/announcement usable; preserved inputs and explicit reload on conflict               | Pending              |
| Upload/quarantine/error                | file input usable; progress/status announced; unavailable attachment/submit clearly explained; retry recovery accessible | Pending              |
| Review decisions                       | feedback/private notes distinction clear; confirmation read in context; immutable outcome announced                      | Pending              |
| Private download                       | file control named; authentication failure/unavailable response understandable; download usable on platform              | Pending              |
| 200% and 400% zoom/reflow              | no lost content/actions or two-dimensional scrolling for normal text; dialogs usable                                     | Pending              |
| Reduced motion                         | OS preference respected; no essential information requires animation                                                     | Pending              |
| High contrast / forced colors          | focus, text, boundaries and selected/error states discernible without color alone                                        | Pending              |
| Mobile screen-reader gestures          | logical swipe order, correct names/roles/states, file input/dialog/download operable                                     | Pending              |
| Touch targets / keyboard overlays      | controls usable without accidental actions; focused fields and confirmations remain visible                              | Pending              |
| Session expiry/revocation              | private content clears/denies on refresh/action; sign-in recovery is understandable; no silent submission loss           | Pending              |
| Scanner/notification/service failure   | affected action explained without alarming unrelated restart cycles; no unsafe download or false delivery confirmation   | Pending              |

## Reproducible device journeys

Run registration → captured verification → pending account → authorized approval;
then draft → PDF upload → quarantine status → authorized synthetic/real validated scan
as explicitly designated → submit → exact reviewer invitation/acceptance → assignment
→ start/return → author amendment → new assignment → acceptance → private download.
Exercise rejection, revocation, timeout, outage and long feedback. Check confidentiality
with an unrelated disposable account. Device testers do not receive operator credentials.

| Platform                       | Required focus                                                                                     | Physical result |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------- |
| Android Chrome + TalkBack      | file picker, private PDF download, back navigation, keyboard overlay, session expiry               | Pending         |
| iPhone Safari + VoiceOver      | file picker/share/download, viewport resizing, focus/dialog return, cookie/session handling        | Pending         |
| Tablet, portrait and landscape | split/rotated layout, long lists, scrolling and dialogs                                            | Pending         |
| Small mobile, ~320 CSS px      | long feedback/status wrap, touch controls, upload progress, 400% equivalent reflow where supported | Pending         |
| Desktop supported browsers     | keyboard/screen reader/zoom/forced colors/reduced motion, full review and recovery paths           | Pending         |

Automated viewports cover Chromium 320×740, 390×844, 768×1024 and 1440×1000. They are
emulation, not Android/iOS hardware or Safari/WebKit acceptance. Firefox/WebKit and
physical OS/browser versions must be selected and recorded by the owner. Link actual
issues and retests to the release matrix; retain human status Pending until completed.
