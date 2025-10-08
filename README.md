# Bastet Console

Management console for Bastet nodes.

## Getting started

1. Install dependencies

   ```bash
   npm install
   ```

2. Create a `.env` file (or use your shell) and provide the Supabase credentials:

   ```bash
   cp .env.example .env
   ```

   Update the values in `.env` with your Supabase URL and anon key.

3. Run the development server

   ```bash
   npm run dev
   ```

   The console will be available at [http://localhost:5173](http://localhost:5173).

4. Build for production

   ```bash
   npm run build
   ```

## Environment variables

| Variable                 | Description                         |
| ------------------------ | ----------------------------------- |
| `VITE_SUPABASE_URL`      | Your Supabase project URL           |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public API key        |

If these values are not provided, the UI will highlight the missing configuration in the administration section and
prevent Google authentication from being triggered.

## Authentication

Google sign-in is powered by Supabase Auth. Ensure the redirect URL matches the domain you deploy to (for local
development, `http://localhost:5173` should be added in the Supabase dashboard under Authentication → URL Configuration).
