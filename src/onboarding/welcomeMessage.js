// Fixed team mentions for the welcome message - these are specific named
// people (Noah as CSM, Andrew as CMO), not per-automation routing config, so
// they live here as constants rather than env vars, same as other message
// copy in this codebase.
const NOAH_CSM_MENTION = '<@414934911724552202>';
const ANDREW_CMO_MENTION = '<@491021691367981056>';
const FRANCIS_COO_MENTION = '<@584241323981406221>';

export function formatWelcomeMessage({ memberMention, notionDashboardUrl }) {
  const dashboardLink = notionDashboardUrl?.trim() ? notionDashboardUrl.trim() : '[Insert Link]';

  return `${memberMention} — welcome to The Called 🔥

You didn't just sign up for a program. You stepped into a brotherhood of men who are done playing small in business and in life and we take that seriously. Glad you're here.

Here's who's in your corner:
${NOAH_CSM_MENTION} is your CSM (Client Success Manager) — With an incredible track record, he is a wealth of knowledge and will be your point of contact from here forward. He'll review your work, keep you accountable, and make sure the effort you put in actually turns into progress you can see.
${ANDREW_CMO_MENTION} is our CMO, he's behind the marketing and systems that power everything you'll be using here.
I'm ${FRANCIS_COO_MENTION}, COO, I run the operations on the backend so your experience here runs the way it's supposed to. I also help with the DM Setting side of the business.

Below are you first tasks and a short walkthrough video so you know exactly what to knock out. Get through both before you hop on your 1:1 onboarding call with Noah.

Let's get to work 📈

---
Here is your Notion Dashboard: ${dashboardLink}
* Complete "THE LEADER WITHIN" protocol — lays the foundation before we build anything
* Complete "ONBOARDING SPRINT" — gets your first moves in motion

Let us know if you have any questions along the way. Once again, make sure both are complete before you get on your call. The booking link for your 1:1 call is inside the notion.

---
🚨 One more thing — reply here with your **email address** so we can get your account linked up.`;
}
