# Calendar Pilot

An AI-powered calendar and scheduling application built with React, TypeScript, and Supabase. Calendar Pilot allows users to create events using natural language or by uploading documents/images, with intelligent parsing powered by OpenAI.

## Features

### 🚀 Core Functionality

- **AI-Powered Event Creation**: Create calendar events using natural language (e.g., "Meeting on October 3rd at 8:30 am")
- **Smart Document Parsing**: Upload images or documents containing schedules, and AI automatically extracts events
- **Multi-View Calendar**: Switch between month, week, and day views
- **Event Management**: Full CRUD operations for calendar events
- **Dark/Light Theme**: Toggle between dark and light modes with persistent preferences

### 🔐 Authentication

- Email/password authentication
- OAuth providers: Google, GitHub, Apple (Sign in with Apple)
- Secure session management using Supabase Auth

### 💳 Subscription Plans

**Free Plan**
- 500 AI tokens per month
- 1 file upload per month

**Student Pack** (One-time upgrade)
- 500 AI tokens per month
- 5 total file uploads (lifetime)

**Pro Plan** (Monthly subscription)
- 5,000 AI tokens per month
- 4 new file uploads per month

### 🛡️ Built-in Safeguards

- Token usage tracking and quota enforcement
- Upload limits based on subscription tier
- Content size validation (max 2000 tokens per upload) to prevent abuse
- Intelligent error handling for API failures

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **AI**: OpenAI API (gpt-4o-mini for text, gpt-4o for images/documents)
- **Payments**: Stripe (ready for integration)
- **Styling**: Custom CSS with CSS variables for theming
- **Date Utilities**: date-fns

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- OpenAI API key
- Stripe account (for payments)

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Update `.env` with your credentials:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

### 3. Database Setup

The database schema is already created in Supabase with:
- `users` - User profiles and plan information
- `events` - Calendar events
- `subscriptions` - Active subscriptions
- `token_usage` - AI token consumption tracking
- `upload_quotas` - File upload quota tracking

All tables have Row Level Security (RLS) enabled.

### 4. Run Development Server

```bash
npm run dev
```

### 5. Build for Production

```bash
npm run build
```

## Mobile Deployment (Capacitor)

To deploy as a native iOS/Android app:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add ios
npx cap add android
npm run build && npx cap sync
```

## License

MIT
