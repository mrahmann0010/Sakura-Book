# State management strategy

Which tool owns a given piece of state depends on where it lives and how long it lasts.

| State type | Tool |
| --- | --- |
| Books, orders, order status (server data) | React Query |
| Cart (client, persisted) | Redux Toolkit + redux-persist |
| Forms (shipping, payment, search) | React Hook Form + Zod |
| UI-only (modals, drawers) | Local `useState` |

## Notes

- **Server data** (books, orders, order status) is owned by the backend and can go stale — React Query handles fetching, caching, and revalidation instead of mirroring it into Redux.
- **Cart** is client-owned and must survive a refresh/tab close, so it lives in Redux Toolkit (`apps/web/src/store`) with `redux-persist` layered on top for localStorage persistence. `redux-persist` is not yet installed — add it when cart persistence is implemented.
- **Forms** (shipping, payment, search) use React Hook Form for field state/validation wiring and Zod for schema validation. Neither is installed yet — add both when the first form ships.
- **UI-only state** (modal open/closed, drawer state) stays local `useState` in the component — it never needs to be global.
