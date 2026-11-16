# TANZANITE EXPRESS — Architecture, Data Retention, Backups & Recovery

## 1. Persistent Data Architecture
TANZANITE EXPRESS persists operational records in **Cloud Firestore** (database `ai-studio-6b440dc1-4f6a-446f-a2d4-4e0e36849be8`) synchronized with an atomic local write-through store (`.mik-data/marketplace-store.json` written via `.tmp` rename) to prevent partial writes.

- **Users & Security Isolation**:
  - `users/{uid}` stores non-PII identity, role (`customer`, `supplier`, `staff`, `super_admin`), currency/country preferences, `lastLoginAt`, `loginCount`, and erasure status (`erasureRequestedAt`, `anonymizedAt`).
  - `users/{uid}/private/info` isolates PII (email, phone, saved delivery addresses).
  - Wishlists sync both in memory and in `wishlists/{uid}/items/{productId}`.
- **Orders & Suborder History**:
  - `orders/{orderId}` stores immutable delivery address snapshots, payment provider/status, and itemized totals.
  - `suborders/{suborderId}` scopes multi-vendor items (`image` thumbnail, `size`, `color`, `unitWholesalePriceUsd`, `unitPriceUsd`, `lineTotalUsd`) and tracks full chronological `statusHistory`.
  - Released historical supplier suborders remain visible in the Supplier Order Center even if subsequently `Cancelled`, `Refunded`, or `Partially Refunded`, preserving supplier accounting accuracy while maintaining strict `supplierId` / `supplierOwnerUid` isolation.

## 2. Smart Notifications & Non-Destructive Clearing
- Real-time delivery uses Server-Sent Events (`/api/notifications/stream`) emitting `notification` and `notifications_sync` events for cross-tab synchronization.
- Notifications support `priority` (`low`, `normal`, `high`, `urgent`) and idempotent `dedupeKey` deduplication.
- **Soft-Hide Model**: Calling `DELETE /api/notifications/:id` or `POST /api/notifications/clear-visible` sets `hiddenByRecipient = true` and `hiddenAt`, keeping the notification document and underlying order/payment/audit records intact. Every hide/clear writes a `NOTIFICATION_HIDDEN_BY_USER` or `NOTIFICATION_CLEARED_BY_USER` entry in `audit_logs`, inspectable in **Super Admin Console → Audit Logs → Notification History Inspector**.

## 3. AI Support Chatbot vs. Support Tickets
- `POST /api/support/assistant` serves conversational EN/SW multi-turn assistance via server-side `@google/genai` (keeping `GEMINI_API_KEY` private). Greetings, thank-you replies, goodbyes, and follow-up turns stay inside chat without triggering support-ticket validation.
- Human support tickets (`POST /api/support/tickets`) are isolated to the dedicated **Talk to a Human Agent** / **Support Desk** form and validate ticket messages (`1–600` characters) independently.

## 4. Checksummed Backups, Verification & Restore Procedure
1. **Creating a Backup**:
   - Super Admins can trigger `POST /api/admin/backups` from **Admin Console → Audit Logs → Checksummed Backups & Restore**.
   - Snapshots are saved to `.mik-data/backups/<backupId>.json` with a **SHA-256 checksum** over the full JSON payload and pruned automatically according to the configured `DataRetentionPolicy`.
2. **Downloading & Auditing**:
   - Use `GET /api/admin/backups/:id` (or **Download** button) to archive off-site copies; integrity is re-verified against the recorded SHA-256 digest before download or restore.
3. **Safe Verified Restore**:
   - Running `POST /api/admin/backups/:id/restore` first captures an automatic `pre_restore` safety snapshot of current production state, verifies the target snapshot SHA-256 checksum, restores marketplace collections, merges preserved audit logs, and logs a `BACKUP_RESTORED` event.

## 5. Self-Service Export & Privacy Anonymization
- Customers and suppliers can export their own sanitized account data (`JSON` or `CSV`) from **Customer Dashboard → Profile & Preferences → Account Security & Activity History** (`GET /api/me/export`) and submit a privacy erasure request (`POST /api/me/erasure-request`).
- Super Admins execute approved requests via `POST /api/admin/users/:uid/anonymize`, scrubbing PII (`displayName`, `email`, `phone`, `addresses`, shipping street fields) while retaining anonymized financial totals, suborder quantities, and immutable audit entries (`USER_PII_ANONYMIZED`).
