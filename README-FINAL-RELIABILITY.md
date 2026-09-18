# Final reliability and sound update

## Sound shuffle bag
- All 26 sale sounds are shuffled into a queue.
- Every sound in the queue plays once before the queue is refilled.
- The first sound in a new queue cannot match the last sound of the previous queue.
- The remaining queue is stored in browser localStorage, so refreshing the dashboard does not restart the sound sequence.

## Important Information persistence
- Sensor matrix rows use Firestore-safe objects rather than nested arrays.
- KPI target saves use merge mode and cannot erase the Important Information data.
- Admin listens live to the targets document and displays detailed save errors.

Asset version: 20260918-6.
