# My Day Desk

An invite-only planner for workouts and meals, built with React, TypeScript, Vite, Firebase Authentication, and Cloud Firestore.

## Run locally

1. Install dependencies with `npm ci` using Node 22 or newer.
2. Copy `.env.example` to `.env.local` and fill in the web app configuration from the separate Firebase project. Use only the client SDK values here.
3. Run `npm run dev`. Add `localhost` to Firebase Authentication's authorized domains if testing Google sign-in locally.
4. Run `npm run build` before pushing an update.

## Access and invitations

Enable Google as the sign-in provider and create the default Firestore database in the My Day Desk project. Publish `firestore.rules` in the console or run `firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`.

In Firestore, create one document in `invitations` per invitee. Use their exact Google account email as the document ID and any metadata field such as `invited: true`. The rules check for the document's existence. Removing the document revokes access. Only Firebase project administrators can manage invitations. An uninvited user who selects Google may appear in the Firebase Authentication user list, but cannot enter the workspace or access plan records.

## Preview and publish updates

- Set the client SDK variables from `.env.example` for the Vercel project in Preview and Production.
- Push a feature branch and open a pull request to get a Vercel preview URL. Add its exact hostname to Firebase Authentication's authorized domains. Use a stable preview hostname when available.
- Check both Fitness and Diet, creation and editing, account switching, mobile navigation, and the saved theme. With two invited accounts, check that each can see and edit its own records only. Also try an uninvited account.
- After preview approval, merge to the production branch or promote the verified deployment. Add the production hostname to Firebase Authentication's authorized domains and verify the live URL.
