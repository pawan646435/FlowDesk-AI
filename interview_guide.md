# Interview Prep & System Architecture Study Guide

This document covers the architectural rationale, implementation designs, scaling strategies, and common technical interview topics for FlowDesk AI's AI Analysis and n8n webhook integrations.

---

## 1. AI-Powered Ticket Analysis (Google Gemini API)

### Why It Exists
In traditional support ticket desks, incoming requests are triaged manually by humans. This creates a bottleneck, delaying critical issues. Automating this triage via LLMs:
* Categorizes issues instantly (Billing, Refund, Technical, etc.).
* Gauges user sentiment to prioritize angry customers.
* Suggests email drafts to reduce support engineer response latency.

### How It Works
When a ticket form is submitted, the backend intercepts the title and description and feeds them to the **Gemini 1.5 Flash** model. We pass a strict JSON Schema configuration (`responseSchema`) to the generative client. This constrains the LLM output, forcing it to return a valid JSON object matching our Prisma enums (e.g. `BILLING`, `HIGH`, `NEGATIVE`).

### Alternatives
* **Rule-based regex mapping**: Low cost and zero latency, but brittle. It fails to categorize "I cannot log in" as `ACCOUNT` unless specifically coded.
* **Classical ML Classifiers (TF-IDF + SVM)**: Fast and runs locally, but requires gathering and labeling training datasets and lacks generative suggestion capabilities.
* **Fine-Tuned Small Language Models (e.g. LLaMA-3-8B)**: Extremely accurate, but introduces hosting, cold starts, and GPU operational overhead.

### Scaling & Production Considerations
1. **API Rate Limits**: Cloud providers impose rate limits (QPM/RPM) on model endpoints. Under heavy traffic spikes, requests may be throttled. 
   - *Mitigation*: We implement a local fallback mechanism that shifts to rule-based heuristics if the key is missing or the API returns a `429 Too Many Requests` status.
2. **Latency (INP & LCP)**: LLM calls take 1–2 seconds. Blocking the user registration screen for API generation degrades user experience.
   - *Mitigation*: We perform classification asynchronously or run LLM evaluations in background workers (using BullMQ, Celery, or serverless queues) rather than blocking the main HTTP client thread.

### Common Interview Questions
* **Q: What happens if the LLM fails to return valid JSON or returns a category not defined in your database?**
  * *Answer*: We use Gemini's native **Structured Outputs** feature which guarantees that outputs conform to the specified JSON schema. In addition, we wrap the operation in a try/catch block, falling back to a deterministic rule-based parser if parsing fails, ensuring database operations never fail.
* **Q: Why use `gemini-1.5-flash` instead of `gemini-1.5-pro`?**
  * *Answer*: Triage tasks are low-complexity but high-frequency. `gemini-1.5-flash` provides ~10x lower latency and significantly lower token cost while being highly accurate at classification, making it the optimal choice for production scaling.

---

## 2. Webhook & n8n Automation Services

### Why It Exists
Integrating Next.js directly with external services (Slack, PagerDuty, email providers) leads to high codebase coupling. If you want to change an automation step, you must write code, redeploy the app, and re-run tests.
Using **n8n** decouples the core app logic: Next.js emits a standardized webhook event, and the visual workflow manager handles notifications.

### How It Works
The service layer implements Fetch POST requests targeting n8n endpoints. Webhook payloads contain normalized attributes (`ticketId`, `title`, `category`, `priority`). On execution, n8n parses the body, logs details in container output, evaluates priorities, and escalates critical bugs.

### Alternatives
* **Queue Brokers (RabbitMQ / BullMQ)**: Highly reliable and supports message acknowledgment, but requires managing extra infrastructure (Redis/AMQP) and lacks visual workflow debugging.
* **Direct Integration**: Directly calling API endpoints (e.g., Slack SDK) inside the Next.js server actions. Poor modularity and high code complexity.

### Scaling & Production Considerations
* **Database Transactions Guarding**: External API or webhook calls must **never** be executed inside SQL database transactions. If the external webhook takes 10 seconds to respond, the database connection is held open, quickly exhausting the connection pool and crashing the app.
  - *Mitigation*: Our service runs the Prisma database transaction first, commits the write, and then triggers the webhook calls asynchronously outside the transaction block.
* **Webhook Reliability**: If n8n goes down, webhook events are lost.
  - *Mitigation*: In production, we write events to an **Outbox Table** in the database. A separate background worker reads from the outbox table, attempts to send the webhook, and retries on failure with exponential backoff.

### Common Interview Questions
* **Q: How do you handle webhook security? How does n8n know the request came from your app?**
  * *Answer*: We sign the webhook payload using a secret key (HMAC-SHA256) and pass the signature in the `X-Hub-Signature` header. The receiver (n8n) hashes the body with the shared secret and verifies the signature before processing the event.

---

## 3. Containerized Deployments (Docker Compose)

### Why It Exists
Enforces environment parity: n8n runs identically on the developer's laptop, staging, and production servers, eliminating "it works on my machine" bugs.

### How It Works
The `docker-compose.yml` file defines an n8n service mapping host port `5678` to container port `5678`. It mounts a persistent volume `n8n_data` to `/home/node/.n8n` to preserve user workflows across restarts.

### Scaling & Production Considerations
* **Database Backend**: The default local docker compose runs n8n using an embedded SQLite database. SQLite is a single-file database and does not scale well with high concurrency or parallel workflow executions.
  - *Mitigation*: In production, we update `docker-compose.yml` to run n8n with a dedicated PostgreSQL database service container, enabling connection pooling and daily automated backups.
* **High Availability (HA)**: Running multiple instances of n8n behind a load balancer. n8n supports queue mode (running worker containers powered by Redis) to distribute execution workloads.
