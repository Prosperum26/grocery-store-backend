# Known risks

Risks found while building and testing the backend that are **not fixed yet**. Each row says where it was observed and what would fix it. Update the row when a risk is fixed or its status changes.

Last updated: 2026-11-03.

| # | Risk | Where it was seen | Impact | Status / fix |
| :--- | :--- | :--- | :--- | :--- |
| R1 | **Paying with an old VNPAY link.** Creating a second payment session for the same cart deletes the first one. If the customer still pays with the first link (two tabs, an old link), the IPN finds no session and answers `01`. | HS-0 spike (`verified-apis.md`, HS-0) | Money taken, no order, no refund | Open. The 10-minute link (hot-stock plan D2) narrows the window. Fix: the IPN looks the session up with `withDeleted` and refunds. Not planned yet |
| R2 | **Silent refund failure after a failed cart completion.** When completing the cart fails after the payment was captured (for example Postgres has no stock left), Medusa refunds through the provider by itself, but a refund error is only logged. | HS-0 spike | Money taken, no order, nobody notified | Open. Hot-stock plan HS-6: the reconcile job lists captured payments without order or refund and marks the cart for the admin |
| R3 | **Paid but the last unit went to another customer's hold.** The hold expires before a late IPN arrives and someone else holds the last unit in between. Postgres still has the unit, so Medusa would complete the order and the other customer's hold would no longer be backed by stock. | Design discussion, hot-stock plan D4 | Overselling, or refunding a paid customer | Planned: HS-6 retries the hold when the IPN arrives; out of stock means refund through `refund-client.ts` |
| R4 | **Refund API not verified.** Refunds (customer cancel BE-8, R2, R3) have only run against test keys; VNPAY answers `99`. Codes such as `94` (duplicate request) and network errors are not handled. | BE-8, HS-0 | Cancel returns `502 REFUND_FAILED`; R2 and R3 cannot complete | Waiting for a real VNPAY sandbox account |
| R5 | **Payment flow only simulated.** No real sandbox account yet: payment signature encoding, IPN through an HTTPS tunnel and the return page have only been tested with IPNs signed by a test key. | BE-5, storefront plan question 10 | Unknown until tested | Waiting for a real VNPAY sandbox account |
| R6 | **Stock shown to customers ignores holds.** `inventory_quantity` from the Store API is Medusa's number (`stocked − reserved`). Units held in Redis are not subtracted, so a badge can show "Còn 1" while that unit is held. | Hot-stock design | Customer is stopped at the reserve step, not earlier | Planned: HS-8 (`GET /store/stock` and Socket.io read Redis) |
