# Shared button feedback

All application buttons and forms use `ActionButton` and `ActionForm`. They retain native button
and form properties, browser validation and existing page handlers. The root `ButtonFeedback`
provider also covers sign-in and recovery screens.

An enabled click temporarily shows cyan Clicked feedback. Associated asynchronous handlers,
API requests and TanStack mutations keep the initiating button amber and busy until settlement.
Existing specific pending labels take precedence over Working…. A rejected action briefly
shows red Failed feedback; page error handling remains responsible for detailed errors and
recovery. Current labels are restored, including labels changed by toggles or refreshed data.
Screen readers receive polite status announcements and busy state. Reduced motion disables
transitions. Other controls remain usable.

Association is scoped to synchronous dispatch of the original click or submit handler. Returned
promises cover subsequent asynchronous work; the API client and mutation-cache integration also
cover handlers that start requests without returning them. Background polling is independent.
New asynchronous handlers should return their full promise so later work stays associated.
Pending disabling is deferred until native submit activation finishes to preserve submission.

Response settlement is not background job completion. Existing Queue, validation, review,
import, delivery and media-server confirmation stages remain unchanged. Disabled controls do
not acknowledge activation. A cancelled dialog or blocked native form receives only transient
click feedback. No database or runtime installation changes are required.

The jsdom browser tests cover acknowledgement, pending lifetime, duplicate prevention, native
form submission/validation, mutation callbacks, direct API requests, failures, background request
isolation and label restoration/unmounting. Production builds and tests run with Node 22.
