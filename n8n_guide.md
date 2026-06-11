# n8n Setup & Workflow Import Guide

This guide details how to run n8n locally using Docker Compose, import the predefined workflows, and connect them to FlowDesk AI.

---

## 1. Running n8n via Docker

FlowDesk AI provides a pre-configured [docker-compose.yml](docker-compose.yml) to deploy n8n containerized in your local environment.

1. Ensure you have **Docker** and **Docker Compose** installed on your machine.
2. In your terminal, navigate to the root of the FlowDesk AI project:
   ```bash
   cd "/Users/pawan/Projects/Flowdesk AI"
   ```
3. Boot the container in detached mode:
   ```bash
   docker compose up -d
   ```
4. Verify the container is running:
   ```bash
   docker ps
   # You should see the 'flowdesk_n8n' container mapping port 5678.
   ```

To stop the container, run:
```bash
docker compose down
```

---

## 2. Accessing the n8n Dashboard
1. Open your browser and navigate to: **[http://localhost:5678](http://localhost:5678)**.
2. If this is your first time starting n8n, follow the on-screen prompts to set up your administrator owner account.

---

## 3. Importing Workflows

We have provided JSON configuration files for our ticket workflows inside the [workflows](workflows/) folder.

### Import the "New Ticket Workflow"
1. In the n8n sidebar, click **Workflows**.
2. Click **+ Add Workflow** or open a blank workflow workspace.
3. In the top-right corner, click the **three dots (...)** menu and select **Import from File**.
4. Upload the [new-ticket-workflow.json](workflows/new-ticket-workflow.json) file.
5. Review the structure:
   - **Webhook Trigger**: Receives payload data (`ticketId`, `title`, `category`, `priority`) on POST path `/webhook/new-ticket`.
   - **Code Node**: Prints ticket information into container console logs and returns a formatted JSON confirmation.
6. Click **Save** in the top right.
7. Click the **Active** toggle switch in the top right to enable the webhook.

### Import the "High Priority Escalation Workflow"
1. Open a new blank workflow.
2. Open the menu, select **Import from File**, and upload [high-priority-workflow.json](workflows/high-priority-workflow.json).
3. Review the nodes:
   - **Webhook Trigger**: Listens on POST path `/webhook/escalate-ticket`.
   - **Verify High Priority**: An IF condition check matching priority variables to `HIGH`.
   - **Escalate Action**: Logs alert warnings in stdout.
4. Click **Save** and click the **Active** toggle switch to enable it.

---

## 4. Connecting FlowDesk AI Webhooks

* When running n8n locally inside Docker, its webhook path is:
  - New Ticket: `http://localhost:5678/webhook/new-ticket`
  - High Priority: `http://localhost:5678/webhook/escalate-ticket`
* If these match your `.env` values, FlowDesk AI will communicate with n8n automatically whenever you submit support forms!
* You can check stdout in your n8n docker logs to inspect incoming request logs:
  ```bash
  docker logs -f flowdesk_n8n
  ```
