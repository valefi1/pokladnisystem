# v1.18 - Import sync race fix

- Fixed a Supabase synchronization race where a periodic remote pull could overwrite a freshly imported stock/product snapshot before the local import had finished syncing to Supabase.
- Local changes now mark the state as pending and remote polling is paused until the write to Supabase completes.
- In-flight remote reads that started before a local edit/import are ignored when they return later.
