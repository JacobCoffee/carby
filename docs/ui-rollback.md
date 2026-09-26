# UI rollback

This document previously pointed to a specific commit hash and local tag from
the original private development history. That history is not published in
this repository, so those identifiers are not usable here.

To roll back a UI redesign in this repository: before starting a redesign,
tag the last commit with the previous layout (for example
`git tag ui-baseline-vN`), and land record-integrity fixes in separate commits
from the visual redesign. To restore the previous appearance while retaining
fixes, revert the later UI commit(s) and republish, rather than resetting the
whole branch; reconcile any intervening fix commits by hand.

Do not restore an old data backup as part of a UI rollback. A UI rollback does
not require deleting or rewinding records, credentials, access settings, or
care plans. No background worker or host migration is part of this change.
