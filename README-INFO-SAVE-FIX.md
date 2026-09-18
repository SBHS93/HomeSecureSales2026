# Important Information Save Fix

- KPI target saves now use Firestore merge mode, so they cannot delete `infoPage`.
- Admin listens live to `targets/main`, keeping the editor synchronized.
- Important Information save now shows Saving, Saved, or Failed status.
- Saving writes `infoPageUpdatedAt` for diagnostics.
- Asset version is `20260918-4`.
