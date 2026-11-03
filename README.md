# Clear Sites CRM (customers + expenses)

Private team app for customers and expenses. Black, white and gray.
Only the owner can delete. Everyone on the team can add and edit and sees everything. Customers never log in.

## Try it now (demo mode)
`npm install` then `npm run dev`. With no keys in `src/config.js` it runs on fake data saved in your browser only.
Open `?as=member` at the end of the address to see what Ryan or Alex see (no Delete button).

## Go live (about 10 minutes, free)
1. Create a free project at supabase.com. Save the database password somewhere safe.
2. Project Settings > API: copy the Project URL and the `anon` public key into `src/config.js`. Never use the `service_role` key.
3. SQL Editor > New query: paste all of `schema.sql` and press Run.
4. Authentication > Users > Add user: create one user per team member (email + password, tick "Auto confirm").
5. SQL Editor: add them to the team (replace the emails):
```sql
insert into team (user_id, name, role) select id, 'Owner Name', 'owner'  from auth.users where email = 'OWNER@EMAIL';
insert into team (user_id, name, role) select id, 'Member One', 'member' from auth.users where email = 'MEMBER1@EMAIL';
insert into team (user_id, name, role) select id, 'Member Two', 'member' from auth.users where email = 'MEMBER2@EMAIL';
```
6. Authentication > Providers > Email: turn OFF "Allow new users to sign up" so strangers cannot create accounts.
7. `npm run build` writes the site to `docs/`. Commit it and turn on GitHub Pages (Settings > Pages > Deploy from branch > main > /docs).

Anyone who signs in but is not in the `team` table sees "No access" and can read nothing (enforced by the database, not just the page).

## Not stored
Card numbers, Social Security numbers and passwords. Stripe holds cards. Use a password manager for passwords.
