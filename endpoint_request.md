# Endpoint Request — Seller Funnel Internal Tool

## Context

We have an internal inspection tool ("Funneltool") that reads seller funnel submission data from S3. We need to enrich this with deal/submission data from the Seller Funnel database. The tool is a Node.js/Express backend that will call these endpoints server-to-server.

We need **two REST endpoints** added to the Seller Funnel BE.

---

## Database schema (provided)

```
submission: id, created_at, updated_at, session_id, vin, pipedrive_deal_id, last_synced_at,
            form_intake, pipedrive_sync_status, identifier_information_id, submission_data (jsonb),
            submission_source, form_id, registration_country, idempotency_key

dat_information: id, created_at, updated_at, vin, first_registration, dat_ecode, container,
                 description, make, model, variant, is_confirmed, construction_time,
                 container_description, kba_number, construction_time_from, construction_time_to,
                 identification_source, country, list_price_with_options, list_price_without_options,
                 special_equipment_price, power_kw, capacity, fuel_method, drive_type,
                 special_equipments (jsonb), email, is_dat_confirmed_optional_equipment,
                 is_dat_confirmed_vehicle_selection, standard_equipments (jsonb),
                 extra_equipments (jsonb), registration_country, vehicle_type, mileage

image_processing_job: id, created_at, updated_at, deal_id, status, source, save_local,
                      result (jsonb), error, completed_at, vin

vin_history: id, created_at, updated_at, vin, first_registration, match_count, number_of_request
```

---

## Endpoint 1 — List submissions

**`GET /api/submissions`**

Returns a paginated list of submissions for display in a table.

### Query parameters
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number, 1-indexed, default `1` |
| `pageSize` | number | Items per page, default `20`, max `100` |
| `vin` | string | Filter by VIN (partial match / ILIKE) |
| `from` | ISO date string | Filter `created_at >= from` |
| `to` | ISO date string | Filter `created_at <= to` |

### Response shape
```json
{
  "total": 142,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "...",
      "created_at": "...",
      "updated_at": "...",
      "vin": "...",
      "session_id": "...",
      "form_intake": "...",
      "form_id": "...",
      "pipedrive_deal_id": "...",
      "pipedrive_sync_status": "...",
      "submission_source": "...",
      "registration_country": "..."
    }
  ]
}
```

> Note: Do **not** include `submission_data` in the list response — it can be large and is only needed in the detail view.

---

## Endpoint 2 — Submission detail

**`GET /api/submissions/:id`**

Returns the full record for a single submission, enriched with all related data.

### Response shape
```json
{
  "submission": {
    "id": "...",
    "created_at": "...",
    "updated_at": "...",
    "session_id": "...",
    "vin": "...",
    "pipedrive_deal_id": "...",
    "last_synced_at": "...",
    "form_intake": "...",
    "pipedrive_sync_status": "...",
    "identifier_information_id": "...",
    "submission_data": { },
    "submission_source": "...",
    "form_id": "...",
    "registration_country": "...",
    "idempotency_key": "..."
  },
  "dat_information": {
    "id": "...",
    "vin": "...",
    "make": "...",
    "model": "...",
    "variant": "...",
    "first_registration": "...",
    "dat_ecode": "...",
    "container": "...",
    "container_description": "...",
    "description": "...",
    "is_confirmed": true,
    "construction_time": 0,
    "construction_time_from": "...",
    "construction_time_to": "...",
    "identification_source": "...",
    "country": "...",
    "registration_country": "...",
    "vehicle_type": "...",
    "mileage": 0,
    "power_kw": 0,
    "capacity": 0,
    "fuel_method": "...",
    "drive_type": "...",
    "list_price_with_options": 0,
    "list_price_without_options": 0,
    "special_equipment_price": 0,
    "kba_number": [],
    "email": "...",
    "is_dat_confirmed_optional_equipment": true,
    "is_dat_confirmed_vehicle_selection": true,
    "special_equipments": {},
    "standard_equipments": {},
    "extra_equipments": {}
  },
  "image_processing_jobs": [
    {
      "id": "...",
      "created_at": "...",
      "updated_at": "...",
      "deal_id": "...",
      "vin": "...",
      "status": "...",
      "source": "...",
      "save_local": true,
      "result": {},
      "error": null,
      "completed_at": "..."
    }
  ],
  "vin_history": {
    "id": "...",
    "vin": "...",
    "first_registration": "...",
    "match_count": 0,
    "number_of_request": 0,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Notes
- `dat_information` and `vin_history` may be `null` if no record exists for the submission's VIN
- `image_processing_jobs` may be an empty array
- `dat_information` should be looked up by VIN (`submission.vin = dat_information.vin`)
- `image_processing_jobs` should be looked up by VIN or deal ID — use whichever join is available
- `vin_history` should be looked up by VIN

---

## General requirements

- JSON responses with `Content-Type: application/json`
- Return `404` with `{ "error": "Not found" }` if a submission ID does not exist
- No auth required for now (internal tool, called server-to-server)
