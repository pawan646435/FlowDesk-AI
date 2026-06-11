# Installation Guide

Follow these steps to set up and run FlowDesk AI on your local machine.

## Prerequisites
* **Node.js**: v18.0.0 or higher (v20+ recommended)
* **NPM**: v9.0.0 or higher
* **PostgreSQL Database**: A running instance (or Neon connection URL). See [setup.md](setup.md) for details.

---

## 1. Install Dependencies
Clone the repository, navigate to the root directory, and install the npm packages:
```bash
git clone <repository-url>
cd flowdesk-ai
npm install
```

---

## 2. Configure Environment Variables
Copy the environment template into a local file:
```bash
cp .env.example .env
```
Open the `.env` file and replace the placeholder values with your database credentials and OAuth credentials (see [setup.md](setup.md) for how to retrieve them):
* `DATABASE_URL`
* `AUTH_SECRET`
* `AUTH_GOOGLE_ID`
* `AUTH_GOOGLE_SECRET`

---

## 3. Synchronize the Database Schema
Push the Prisma models to your remote or local database to create the tables, relationships, and indexes:
```bash
npx prisma db push
```

*(Optional)* Run the Prisma Studio GUI if you want to inspect or modify tables directly:
```bash
npx prisma studio
```

---

## 4. Run the Development Server
Start the Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the application.
* Public landing page: `/`
* Login view: `/login` (redirects automatically if accessing protected pages)
* Ticket dashboard: `/dashboard`
* Tickets list & details: `/tickets`
