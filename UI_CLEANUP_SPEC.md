# Detail Page UI Cleanup Spec

## Header Card (unchanged)
Already clean. Shows:
- Submission ID
- VIN
- Form intake (M1 / M1.5 badge)
- Pipedrive sync status (badge)
- Updated date
- Created date
- Last synced date
- Deal ID
- Asset count

---

## "Submission (DB)" Section → REMOVED
**Reason:** 100% redundant with the header card, plus technical-only fields.

| Field | Action | Reason |
|-------|--------|--------|
| `id` | Hidden | Already in header |
| `created_at` | Hidden | Already in header |
| `updated_at` | Hidden | Already in header |
| `vin` | Hidden | Already in header |
| `pipedrive_deal_id` | Hidden | Already in header |
| `pipedrive_sync_status` | Hidden | Already in header |
| `form_intake` | Hidden | Already in header |
| `last_synced_at` | Hidden | Already in header |
| `submission_source` | Hidden | Technical |
| `form_id` | Hidden | Technical |
| `registration_country` | Hidden | Shown in vehicle card |
| `session_id` | Hidden | Technical |
| `identifier_information_id` | Hidden | Technical / internal FK |
| `idempotency_key` | Hidden | Technical |
| `submission_data` | Hidden | Was already excluded; shown separately when non-null |

---

## "DAT Information" → Replaced with "Vehicle Information" card

### Shown (combined into a compact card)
| Display label | Source field(s) | Format |
|---------------|-----------------|--------|
| Vehicle | `make` + `model` + `variant` | Combined into one line, e.g. "Tesla Model Y Long Range Dual AWD" |
| First registration | `first_registration` | Date |
| Mileage | `mileage` | Formatted with " km" suffix |
| Power | `power_kw` | "378 kW" |
| Fuel | `fuel_method` | As-is, e.g. "Elektro" |
| Drive | `drive_type` | Uppercased, e.g. "AWD" |
| Battery / Capacity | `capacity` | "75 kWh" |
| Country | `country` | Uppercased country code |
| DAT confirmed | `is_confirmed` | Green ✓ / Red ✗ badge |

### Hidden
| Field | Reason |
|-------|--------|
| `id` | Internal DB primary key |
| `vin` | Already in header |
| `dat_ecode` | Technical DAT identifier |
| `container` | Technical DAT code |
| `container_description` | Technical DAT grouping |
| `description` | Redundant with make + model + variant |
| `construction_time` | Often placeholder value (9999) |
| `construction_time_from` | Technical |
| `construction_time_to` | Technical |
| `identification_source` | Technical |
| `vehicle_type` | Technical code |
| `list_price_with_options` | Null / not populated |
| `list_price_without_options` | Null / not populated |
| `special_equipment_price` | Null / not populated |
| `kba_number` | Technical registration codes |
| `email` | Null / not relevant here |
| `registration_country` | Redundant with `country` |
| `is_dat_confirmed_optional_equipment` | Null / technical |
| `is_dat_confirmed_vehicle_selection` | Null / technical |

### Equipment lists → Collapsible sections
- **Special equipment**: shows count, collapsed by default. Expands to list of `description` values only. Hides: `datEquipmentId`, `equipmentClass`, `equipmentGroup`, `originalPrice`, `isSelected`.
- **Standard equipment**: shows count, collapsed by default. Expands to list of `description` values only. Hides: `datEquipmentId`, `equipmentClass`, `equipmentGroup`.
- **Extra equipment**: only shown if non-empty.

---

## "VIN History" → Replaced with single status line
| Display label | Source field | Format |
|---------------|-------------|--------|
| VIN Matches | `match_count` | Badge with count, e.g. "2 matches" |

### Hidden
| Field | Reason |
|-------|--------|
| `id` | Internal DB primary key |
| `vin` | Already in header |
| `first_registration` | Already in vehicle card |
| `number_of_request` | Technical / internal counter |
| `created_at` | Technical |
| `updated_at` | Technical |

---

## "Image Processing Jobs" → Single status line (already done)
Shows completed/failed badge with optional raw JSON toggle.

---

## "Submission Data (JSONB)" → Kept as raw dump
Only shown when non-null. This is form-specific variable data, so raw display is acceptable for now.

---

## Asset Gallery (unchanged)
Already clean. Shows image/document thumbnails with download options.
