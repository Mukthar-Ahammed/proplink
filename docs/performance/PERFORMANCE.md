# Performance targets and results

Phase 7 Task 5 (ADR-066). Measured locally against the disposable test
database (PostgreSQL 16 + PostGIS in Docker on a development laptop), server
side: database plus result hydration, without network or rendering. Staging
numbers are part of H7.2.

## How to run

```bash
# Disposable test database only (the test refuses anything else).
npm run test:perf                    # about 5,000 live listings
PERF_LISTINGS=40000 npm run test:perf
```

`tests/perf/performance.perf.test.ts` copies the seeded live listings (with
their tags and images) up to the requested volume, adds 2,000 messages to one
chat, runs each query 30 times after a warm-up, checks the plans with
`EXPLAIN`, writes `test-results/perf.json`, and removes everything it added.
It is not part of `npm run test`.

## Targets

| Area                  | Target (p95, server side)  | Why                                        |
| --------------------- | -------------------------- | ------------------------------------------ |
| Search, any filter    | under 300 ms               | Search page should render within about 1 s |
| Chat history and poll | under 100 ms               | Messages should feel immediate             |
| Health check          | under 2 s or reported down | Uptime monitors                            |

## Results (2026-11-19)

| Query                       | 4,905 listings: median / p95 | 39,894 listings: median / p95 |
| --------------------------- | ---------------------------- | ----------------------------- |
| Browse (no filter)          | 16 / 27 ms                   | 58 / 102 ms                   |
| Free text                   | 20 / 37 ms                   | 144 / 205 ms                  |
| Near a point (25 km)        | 10 / 14 ms                   | 23 / 32 ms                    |
| Map viewport                | 9 / 13 ms                    | 25 / 62 ms                    |
| Price and bedrooms          | 11 / 16 ms                   | 35 / 46 ms                    |
| Distress tag                | 11 / 16 ms                   | 39 / 59 ms                    |
| Page 10                     | 15 / 23 ms                   | 54 / 64 ms                    |
| Chat history (500 of 2,000) | 14 / 23 ms                   | 15 / 23 ms                    |
| Chat poll for new           | 8 / 12 ms                    | 7 / 10 ms                     |

All within target at both volumes.

## Index review (`EXPLAIN`)

| Query                                       | Plan                                                                 | Verdict               |
| ------------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| Radius search                               | Bitmap index scan on `Property_location_gist` (with the agent index) | Good (asserted)       |
| Chat history and poll                       | Index scan on `chat_thread_messages_threadId_createdAt_idx`          | Good (asserted)       |
| Card hydration (image, tags, rating, badge) | Index scans per card on their keys                                   | Good                  |
| Free-text search                            | Sequential scan of `Property` (see below)                            | Follow-up             |
| Agent eligibility (`User`, `AgentProfile`)  | Hash join over active agents                                         | Fine at current sizes |

**Free-text search does not use an index.** The predicate is
`searchVector @@ query OR similarity(title, q) > 0.15 OR similarity(city, q)

> 0.3 OR similarity(postcode, q) > 0.3`; `similarity() > x`cannot use the
existing trigram indexes, so Postgres scans the listings. It meets the
target at 40,000 live listings (p95 205 ms), far above expected launch
volumes. **Trigger to act:** live listings above about 25,000, or text
search p95 above 200 ms in production monitoring. **Remedy:** rewrite each
similarity test as`col % q AND similarity(col, q) > x`with`pg_trgm.similarity_threshold`set to 0.15 for the statement (same
results, index-usable), add a trigram index on`postcode`, and re-run this
> test.

## Image and document delivery

- Public listing images go through `next/image` (AVIF/WebP, resized per
  device, cached by the platform CDN).
- Private documents are streamed by `/api/files/download` after an access
  check, with `Cache-Control: private, no-store` by design. Size is bounded
  by the upload limits (images 10 MB, PDFs 20 MB), so the whole file is held
  in memory once per request; acceptable for these limits. Revisit (stream
  from storage) if limits rise.
- Measuring download times over the network needs staging (H7.2).

## Not measured here

End-to-end realtime chat delivery (Supabase Realtime), page render times and
anything over the network: staging (H7.2).
