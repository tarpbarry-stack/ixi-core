# IXI Freight Production Integration

## Existing IX-Core dependency boundary

Freight is an orchestrating TRAN$ACT business domain. It does not replace MOS movement or IXI Financial.

Required existing services:

- MOS: `/mos/v1/movements/freight`
- MOS: `/mos/v1/movements/:movementId/complete`
- MOS: `/mos/v1/movements/immediate`
- Financial: `/financial/commands/create`

Default internal service base assumes IX-Core port `4100`.

## Mount in the live IX-Core Express bootstrap

```js
const {
  registerFreightSubsystem
} = require("./freight/registerFreight");

const freight = registerFreightSubsystem(app, {
  pool,
  resolveActor: resolveAuthenticatedIXIActor
});

await freight.initialize();
```

`resolveAuthenticatedIXIActor(req)` must resolve the authenticated actor and authorized entity from trusted server authentication. Production registration rejects startup without it.

Do not trust browser-supplied roles, permissions, or managed Passport IDs.

## Environment

```text
IXI_MOS_BASE_URL=http://127.0.0.1:4100/mos/v1
IXI_FINANCIAL_BASE_URL=http://127.0.0.1:4100/financial
IXI_INTERNAL_SERVICE_TOKEN=<service credential if required>
IXI_FREIGHT_ROUTE_PROVIDER=google
GOOGLE_ROUTES_API_KEY=<server-only key>
```

The Google key must never be exposed to the browser.

## Database initialization

`freight.initialize()` creates/indexes:

- `ixi_freight_orders`
- `ixi_freight_events`
- `ixi_command_executions`
- `ixi_asset_moves`

Database credentials remain the existing IX-Core `DATABASE_URL` configuration.

## Production invariants

1. Every asset reference carries MOS object ID + Passport ID.
2. Every command has a stable command ID.
3. Freight mutations use optimistic revision checks.
4. Award creates a Financial `freight` commitment, not a fake Bill.
5. Dispatch creates the MOS Freight Movement.
6. Delivery completes that exact MOS movement; the UI never moves the card itself.
7. Carrier billing creates/links the canonical Financial Bill.
8. Reconciliation records expected vs actual and $/mile without rewriting history.
9. Asset Move uses the MOS immediate-movement command, not Freight.
10. Production actor/entity authority is server-resolved.

## Deployment order

1. Deploy Freight package to the live `/var/www/ix-core` codebase.
2. Mount it through the authenticated IX-Core bootstrap using the snippet above.
3. Configure environment variables.
4. Start/restart IX-Core on port 4100.
5. Run Freight schema initialization.
6. Verify `/freight/v1/queues/open` under authenticated access.
7. Verify route provider with one controlled origin/destination.
8. Verify `AWARD` creates one committed Financial Freight document.
9. Verify `DISPATCH` returns one MOS movement ID.
10. Verify `DELIVER` causes MOS to change the asset's canonical destination relationship.
11. Deploy the matching `ironxchange-homepage` Freight branch.
12. Run one machine end-to-end through create → award → dispatch → pickup → deliver → bill → reconcile.
