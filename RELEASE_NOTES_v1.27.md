# v1.27 - Stock import report visibility

- Fixes missing on-screen report for the **Import stavu skladu** button.
- The existing import handler already wrote status into `importMessage`, but the Products page did not render `importMessage` anywhere.
- Adds a visible success/error card after stock snapshot import with counts and verification details returned from Supabase.
