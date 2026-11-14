### Architecture standard: production, at scale

Each layer scales and fails independently. The design must address every item below or record why it does not apply.

**Layers**
- **Edge and client:** DNS routing; CDN caching static assets close to users.
- **Perimeter:** web application firewall; volumetric DDoS protection.
- **Traffic management:** load balancers; an API gateway handling authentication, rate limiting and routing.
- **Application and compute:** stateless services or functions that can be added and removed on demand.
- **Messaging and async:** queues and event streams that decouple services, buffer spikes and carry background work.
- **Data and storage:** relational stores for transactional data, non-relational stores where the access pattern calls for them, in-memory caches for hot reads.
- **Observability and operations:** centralised logging, real-time metrics, distributed tracing across every layer, with service level objectives and alerting tied to them.

**Scalability and data patterns**
- Horizontal scaling with auto-scaling; no single points of failure.
- Cache-aside for read-heavy data, with explicit invalidation and expiry.
- Sharding or partitioning with a stated shard key, once a single node cannot hold the data.
- CQRS where read and write workloads need to scale or be modelled separately.
- Read replicas, with replication lag accounted for in the design.

**Resilience and fault tolerance**
- Circuit breakers on calls to downstream services, with a defined fallback.
- Retries with exponential backoff and jitter, on idempotent operations only.
- Bulkheads: separate resource pools so one overloaded dependency cannot exhaust the rest.
- Rate limiting and throttling per user and per service.
- Dead letter queues for messages that fail processing, with inspection and replay.
- Idempotency keys on anything retried or delivered at least once.

**Operations**
- Infrastructure as code. Progressive delivery (canary or blue-green) with automated rollback.
- Capacity model and load test results for the stated targets.
- Multi-zone at minimum; multi-region when the availability target requires it.

All of the production security standard applies, including its scale-tier additions.
