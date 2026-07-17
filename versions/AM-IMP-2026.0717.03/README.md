# AM-IMP-2026.0717.03 — Group member picker and refresh

## Outcome

Every AM tenant can refresh a LINE group's member map from the shared OA, then choose that group's main owner and reminder targets from a precise dropdown in the group-governance backend.

For a Portal project entry hosted on another domain, the package also supports a 60-second, single-use Portal SSO handoff. The account's existing `am-<tenant>` feature remains the authority; the AM Platform receives only a signed, local session after the Portal has checked it.

## Data boundary

The refresh request first finds the binding page inside the current tenant's own group-binding data source. It never accepts a browser-provided group ID as authority. The resulting member map is written back with that same tenant key.

## Limitation

The LINE full-member endpoint requires a verified or premium OA. If unavailable, the existing webhook-based member map continues to populate with members who join or speak in the group.
