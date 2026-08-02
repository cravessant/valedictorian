# Workspace wire schemas

`src/contract.ts` is the producer-owned wire authority for the local workspace
surface. Each entry owns the caller-visible method, path template, operation id,
capability, operation class, authentication policy, request-body presence, and
success status. The OpenAPI and private client artifacts are generated only from
that registry.

The existing local server already validates each payload in its route adapter
before it reaches persistence or a connector. Sprint 5 deliberately does not
copy those large domain DTOs into a second shared-types package: doing so would
make the transitional `@sparxie/sdk` facade a second authority and would violate
P04's producer direction. Instead, generated operation components are
operation-specific authored envelopes (`x-authored-schema: true`) and carry a
closure marker (`x-schema-closure: enforced-by-local-adapter`). The adapter's
closed domain validator is the nested wire schema; the registry owns the
transport envelope and its compatibility metadata.

Conformance proves that every route has one operation-specific request/response
component where applicable, every operation is represented once in OpenAPI and
the generated client, unknown paths and method mismatches fail closed, and the
producer never imports generated client code. Adding a new payload field must
therefore update the owning route adapter and its operation component together;
it cannot be introduced through a consumer-side type or a universal schema
package.
