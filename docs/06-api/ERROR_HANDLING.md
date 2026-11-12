# API Error Handling Standard

## 1. Error Envelope

```json
{
  "error": {
    "code": "ACTIVE_TOKEN_EXISTS",
    "message": "You already have an active token at this branch. Please check your original token screen or speak with staff.",
    "details": null,
    "requestId": "req_01JCH9..."
  }
}
```

Zod `400 VALIDATION_ERROR` populates `details.fieldErrors`.

---

## 2. Error Code Catalog

| HTTP | Code | Meaning |
| :---: | :--- | :--- |
| `400` | `VALIDATION_ERROR` | Schema validation failed |
| `401` | `UNAUTHORIZED` | Missing, expired, or revoked session |
| `403` | `FORBIDDEN` | Missing `RolePermission` or Platform Admin role |
| `403` | `BRANCH_ACCESS_DENIED` | Staff member not assigned to requested branch |
| `403` | `TENANT_SUSPENDED` | Organization is suspended or pending approval |
| `403` | `QR_TOKEN_INVALID` | Strict QR mode enabled and `?t=` mismatched |
| `403` | `BRANCH_NOT_ACCEPTING` | Branch closed, outside business hours, or queue paused |
| `404` | `RESOURCE_NOT_FOUND` | Unknown slug, `publicId`, or cross-tenant ID mismatch |
| `409` | `ACTIVE_TOKEN_EXISTS` | Duplicate active token blocked (no PII leaked) |
| `409` | `INVALID_STATE_TRANSITION` | Illegal `TokenStatus` transition |
| `409` | `NO_WAITING_CUSTOMERS` | `Call Next` invoked when waiting queue is empty |
| `409` | `SLUG_TAKEN` | Salon or branch slug already exists |
| `422` | `SERVICE_UNAVAILABLE` | Selected service is inactive or unavailable at target branch |
| `429` | `RATE_LIMITED` | Sliding-window limit exceeded (`Retry-After` header included) |
| `500` | `INTERNAL_ERROR` | Unhandled server error (logged internally; zero raw DB/stack exposure) |

