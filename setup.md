# Setup Guide

This document outlines how to retrieve the necessary API keys and credentials to run FlowDesk AI.

## 1. Database Provisioning (Neon PostgreSQL)

FlowDesk AI uses Neon serverless PostgreSQL for data persistence.

1. Go to [Neon Console](https://neon.tech/) and sign up.
2. Click **Create Project**, select a region near you, name the database `flowdesk_ai`, and click **Create**.
3. Copy the **Connection String** shown in the dashboard.
   It will look something like this:
   `postgresql://neondb_owner:PASSWORD@ep-plain-dew-a5k2j9e9.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Paste this string into your `.env` file as `DATABASE_URL`:
   ```bash
   DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-plain-dew-a5k2j9e9.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```

---

## 2. Google OAuth Credentials

To configure Google Login, you must retrieve a Client ID and Client Secret from the Google Cloud Console.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. In the left sidebar, navigate to **APIs & Services** > **OAuth consent screen**:
   - Select **External** user type and click **Create**.
   - Fill in the required App information (App name: `FlowDesk AI`, User support email, Developer email).
   - Click **Save and Continue** through the scopes and test users.
4. Go to **APIs & Services** > **Credentials**:
   - Click **+ Create Credentials** at the top and select **OAuth client ID**.
   - Under Application Type, select **Web application**.
   - Name it `FlowDesk AI Local`.
   - Under **Authorized JavaScript origins**, click **+ Add URI** and add:
     - `http://localhost:3000`
   - Under **Authorized redirect URIs**, click **+ Add URI** and add:
     - `http://localhost:3000/api/auth/callback/google`
   - Click **Create**.
5. Copy the generated **Client ID** and **Client Secret**.
6. Add them to your `.env` file:
   ```bash
   AUTH_GOOGLE_ID="your-client-id.apps.googleusercontent.com"
   AUTH_GOOGLE_SECRET="GOCSPX-your-client-secret"
   ```

---

## 3. Auth Secret Generation

Auth.js requires a secret to sign and encrypt JWT session cookies.

Generate a random 32-byte string using the command line:
```bash
npx auth secret
```
Or use a secure random hex generator. Paste this value into your `.env` file:
```bash
AUTH_SECRET="your-generated-secret-key"
```
